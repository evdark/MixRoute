import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getNumericSetting, getSetting } from "../db.js";
import { sha256, randomId } from "../crypto.js";
import { resolveConversation, appendAssistantMessage } from "../context.js";
import {
  errorStatus,
  HttpError,
  sendWithFailover,
  streamWithFailover,
  type Attempt,
} from "../router.js";
import { checkRateLimit } from "../ratelimit.js";
import { recordRequest, estimateUsage, promptChars } from "../usage.js";
import type { CanonicalMessage, CanonicalRequest, Usage } from "../types.js";
import type { MakeRequestOptions, StreamOutcome } from "../router.js";
import { writeWithBackpressure } from "../sse.js";

function openaiError(reply: FastifyReply, status: number, message: string, type: string, code?: string) {
  return reply.code(status).send({ error: { message, type, code } });
}

function clientSignal(_request: FastifyRequest, reply: FastifyReply): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const onClose = () => {
    // abort only on a genuine client disconnect (mock responses may lack the flag)
    if (reply.raw.writableEnded === false) controller.abort();
  };
  reply.raw.on("close", onClose);
  return {
    signal: controller.signal,
    dispose: () => reply.raw.off("close", onClose),
  };
}

export async function v1Routes(app: FastifyInstance): Promise<void> {
  function authenticate(request: FastifyRequest): number {
    const header = request.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token) throw new HttpError(401, "Missing API key", "invalid_api_key");
    const row = app.db
      .prepare("SELECT id, revoked FROM api_keys WHERE hash = ?")
      .get(sha256(token)) as { id: number; revoked: number } | undefined;
    if (!row || row.revoked) throw new HttpError(401, "Invalid API key", "invalid_api_key");
    app.db.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").run(Date.now(), row.id);
    return row.id;
  }

  function resolveModelName(raw: unknown): string {
    const requested = typeof raw === "string" && raw.trim() ? raw.trim() : "";
    const name = requested || getSetting(app.db, "default_model");
    if (!name) {
      throw new HttpError(400, "No model specified and no default model configured", "invalid_request");
    }
    const alias = app.db.prepare("SELECT model_id FROM aliases WHERE alias = ?").get(name) as
      | { model_id: number }
      | undefined;
    const modelRow = alias
      ? (app.db.prepare("SELECT name FROM models WHERE id = ?").get(alias.model_id) as { name: string } | undefined)
      : (app.db.prepare("SELECT name FROM models WHERE name = ?").get(name) as { name: string } | undefined);
    if (!modelRow) throw new HttpError(404, `The model '${name}' does not exist`, "model_not_found");
    return modelRow.name;
  }

  function validateBody(body: any): { messages: CanonicalMessage[] } {
    if (!body || typeof body !== "object") throw new HttpError(400, "Invalid JSON body", "invalid_request");
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      throw new HttpError(400, "'messages' must be a non-empty array", "invalid_request");
    }
    for (const m of body.messages) {
      if (!m || typeof m !== "object" || typeof m.role !== "string") {
        throw new HttpError(400, "Each message must have a 'role'", "invalid_request");
      }
    }
    return { messages: body.messages as CanonicalMessage[] };
  }

  app.post("/v1/chat/completions", async (request, reply) => {
    const keyId = authenticate(request);
    const settings = getNumericSetting(app.db, "rate_limit_rpm");
    const rl = checkRateLimit(`key:${keyId}`, settings);
    if (!rl.allowed) {
      reply.header("retry-after", String(rl.retryAfterSec));
      return openaiError(reply, 429, "Rate limit exceeded for router API key", "rate_limit_error", "rate_limited");
    }

    const body = request.body as any;
    const { messages } = validateBody(body);
    const modelName = resolveModelName(body.model);
    const stream = body.stream === true;

    // idempotency: client-supplied request id de-duplicates accidental retries
    const suppliedId = request.headers["x-router-request-id"];
    const requestId = typeof suppliedId === "string" && suppliedId.trim() ? suppliedId.trim() : randomId(12);
    const dup = app.db.prepare("SELECT request_id FROM requests WHERE request_id = ?").get(requestId);
    if (dup) {
      return openaiError(reply, 409, "Duplicate request id", "invalid_request", "duplicate_request_id");
    }

    const explicitId =
      typeof body.conversation_id === "string" && body.conversation_id ? body.conversation_id : undefined;
    const conversation = resolveConversation(app.db, {
      model: modelName,
      messages,
      explicitId,
    });

    const {
      model: _m,
      messages: _msg,
      stream: _s,
      conversation_id: _c,
      user: _u,
      ...params
    } = body ?? {};

    // parameters that commonly provoke a 400/422 on strict providers —
    // dropped on the one degraded retry the router makes for such errors
    const DEGRADE_PARAMS = new Set([
      "response_format",
      "stream_options",
      "frequency_penalty",
      "presence_penalty",
      "seed",
      "logit_bias",
      "logprobs",
      "top_logprobs",
      "parallel_tool_calls",
      "n",
      "user",
    ]);

    const makeRequest = (
      provider: { upstream_model: string },
      opts?: MakeRequestOptions
    ): CanonicalRequest => {
      const base = opts?.degraded
        ? Object.fromEntries(Object.entries(params).filter(([k]) => !DEGRADE_PARAMS.has(k)))
        : params;
      return {
        ...base,
        model: provider.upstream_model,
        messages: conversation.messages,
        stream,
      };
    };

    const { signal, dispose } = clientSignal(request, reply);
    const started = Date.now();
    reply.header("x-router-request-id", requestId);
    reply.header("x-router-conversation-id", conversation.id);

    const logRoute = (attempts: Attempt[], status: number | string, providerName: string) => {
      const chain = attempts.map((a) => `${a.provider}:${a.status}`).join(" → ");
      const time = new Date().toTimeString().slice(0, 8);
      request.log.info(
        `${time} ${modelName} → ${providerName} ${status}${chain ? ` (failover ${chain})` : ""} ${Date.now() - started}ms`
      );
    };

    try {
      if (!stream) {
        const outcome = await sendWithFailover(app.db, modelName, makeRequest, signal);
        const replyContent = outcome.response.choices?.[0]?.message?.content ?? "";
        const usage =
          (outcome.response.usage as Usage | undefined) ??
          estimateUsage(promptChars(conversation.messages), String(replyContent ?? "").length);
        appendAssistantMessage(app.db, conversation.id, replyContent);
        recordRequest(app.db, {
          request_id: requestId,
          conversation_id: conversation.id,
          model: modelName,
          provider_id: outcome.provider.row.id,
          provider_name: outcome.provider.row.name,
          status: 200,
          ok: true,
          streaming: false,
          duration_ms: outcome.durationMs,
          usage,
          attempts: outcome.attempts,
        });
        logRoute(outcome.attempts, 200, outcome.provider.row.name);
        return reply.send(outcome.response);
      }

      // ---- streaming ----
      const gen = streamWithFailover(app.db, modelName, makeRequest, signal);
      let headersSent = false;
      let partial = "";
      let attempts: Attempt[] = [];
      let meta: StreamOutcome | undefined;
      let usageForwarded = false;
      let clientGone = false;

      // backpressure-aware write: a slow client pauses our read of the
      // upstream generator instead of buffering chunks in memory
      const write = async (payload: string): Promise<boolean> => {
        if (!headersSent) {
          reply.raw.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
            "x-router-request-id": requestId,
            "x-router-conversation-id": conversation.id,
          });
          headersSent = true;
        }
        if ((await writeWithBackpressure(reply.raw, payload)) === "closed") {
          clientGone = true;
          return false;
        }
        return true;
      };

      try {
        while (true) {
          const next = await gen.next();
          if (next.done) {
            meta = next.value;
            break;
          }
          attempts = next.value.attempts;
          const choice = next.value.chunk.choices?.[0];
          if (choice?.delta?.content) partial += choice.delta.content;
          if (next.value.chunk.usage) usageForwarded = true;
          if (!(await write(`data: ${JSON.stringify(next.value.chunk)}\n\n`))) break;
        }

        if (clientGone) {
          // stop consuming upstream without finishing: no appendAssistantMessage,
          // no recordRequest, no provider penalty (router never saw a failure)
          await gen.return(undefined as unknown as StreamOutcome);
          request.log.info(
            `client disconnected mid-stream ${modelName} → ${attempts.map((a) => a.provider).join(",") || "?"}`
          );
          dispose();
          return reply;
        }

        if (meta && meta.usage && !usageForwarded) {
          await write(
            `data: ${JSON.stringify({
              id: `chatcmpl-${requestId}`,
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model: modelName,
              choices: [],
              usage: meta.usage,
            })}\n\n`
          );
        }
        await write("data: [DONE]\n\n");
        reply.raw.end();

        const content = meta?.content ?? partial;
        const usage =
          (meta?.usage as Usage | undefined) ??
          estimateUsage(promptChars(conversation.messages), content.length);
        appendAssistantMessage(app.db, conversation.id, content);
        recordRequest(app.db, {
          request_id: requestId,
          conversation_id: conversation.id,
          model: modelName,
          provider_id: meta?.provider.row.id ?? null,
          provider_name: meta?.provider.row.name ?? null,
          status: 200,
          ok: true,
          streaming: true,
          duration_ms: Date.now() - started,
          usage,
          attempts: meta?.attempts ?? [],
        });
        logRoute(meta?.attempts ?? [], 200, meta?.provider.row.name ?? "?");
        dispose();
        return reply;
      } catch (err) {
        const status = errorStatus(err);
        const message = err instanceof Error ? err.message : String(err);
        if (status === 499) {
          // client disconnected — provider already untouched by the router
          await gen.return(undefined as unknown as StreamOutcome);
          request.log.info(`client disconnected ${modelName} → no penalty applied`);
          if (headersSent) reply.raw.end();
          dispose();
          return reply;
        }
        recordRequest(app.db, {
          request_id: requestId,
          conversation_id: conversation.id,
          model: modelName,
          provider_id: null,
          provider_name: attempts.length ? attempts[attempts.length - 1].provider : null,
          status,
          ok: false,
          streaming: true,
          duration_ms: Date.now() - started,
          usage: null,
          error: message,
          attempts,
        });
        request.log.error({ err }, "streaming request failed");
        if (!headersSent) {
          dispose();
          return openaiError(reply, status, message, "api_error");
        }
        // stream already started — cannot change status; terminate cleanly
        if (!clientGone) {
          await write(`\n\n: mixroute error — ${message.replace(/[\r\n]+/g, " ")}\n\n`);
          reply.raw.end();
        }
        dispose();
        return reply;
      }
    } catch (err) {
      const status = errorStatus(err);
      const message = err instanceof Error ? err.message : String(err);
      recordRequest(app.db, {
        request_id: requestId,
        conversation_id: conversation.id,
        model: modelName,
        provider_id: null,
        provider_name: null,
        status,
        ok: false,
        streaming: false,
        duration_ms: Date.now() - started,
        usage: null,
        error: message,
      });
      request.log.error({ err }, "chat completion failed");
      return reply.code(status).send({
        error: {
          message,
          type: "api_error",
          code: err instanceof HttpError ? err.code : undefined,
        },
      });
    } finally {
      dispose();
    }
  });

  app.get("/v1/models", async (request, reply) => {
    authenticate(request);
    const rows = app.db.prepare("SELECT name, created_at FROM models ORDER BY name").all() as {
      name: string;
      created_at: number;
    }[];
    return reply.send({
      object: "list",
      data: rows.map((m) => ({
        id: m.name,
        object: "model",
        created: Math.floor(m.created_at / 1000),
        owned_by: "mixroute",
      })),
    });
  });

  app.get("/health", async (_request, reply) => reply.send({ status: "ok" }));
}
