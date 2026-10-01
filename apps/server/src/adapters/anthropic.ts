import type {
  CanonicalMessage,
  CanonicalRequest,
  OpenAIChunk,
  OpenAIResponse,
  ResolvedProvider,
  StreamResult,
} from "../types.js";
import { AdapterError } from "../types.js";
import type { ProviderAdapter, TestResult } from "./types.js";
import { joinUrl, readErrorBody, sseLines, upstreamFetch } from "./http.js";

const ANTHROPIC_VERSION = "2023-06-01";

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => (part?.type === "text" && typeof part.text === "string" ? part.text : ""))
      .join("");
  }
  return content == null ? "" : String(content);
}

function toAnthropicContent(content: unknown): unknown {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : String(content);
  return content.map((part: any) => {
    if (part?.type === "text") return { type: "text", text: part.text ?? "" };
    if (part?.type === "image_url" && part.image_url?.url) {
      return { type: "image", source: { type: "url", url: part.image_url.url } };
    }
    return { type: "text", text: "" };
  });
}

function convertMessages(req: CanonicalRequest): {
  system?: string;
  messages: { role: "user" | "assistant"; content: unknown }[];
} {
  const systemParts: string[] = [];
  const messages: { role: "user" | "assistant"; content: unknown }[] = [];

  for (const msg of req.messages as CanonicalMessage[]) {
    if (msg.role === "system" || msg.role === "user") {
      if (msg.role === "system") {
        systemParts.push(textOf(msg.content));
        continue;
      }
      if (msg.tool_call_id) {
        // tool result -> user message with tool_result block
        messages.push({
          role: "user",
          content: [{ type: "tool_result", tool_use_id: msg.tool_call_id, content: textOf(msg.content) }],
        });
        continue;
      }
      messages.push({ role: "user", content: toAnthropicContent(msg.content) });
      continue;
    }
    if (msg.role === "assistant") {
      const blocks: any[] = [];
      const text = textOf(msg.content);
      if (text) blocks.push({ type: "text", text });
      for (const tc of (msg.tool_calls ?? []) as any[]) {
        blocks.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function?.name ?? tc.name,
          input: safeJson(tc.function?.arguments ?? "{}"),
        });
      }
      messages.push({ role: "assistant", content: blocks.length ? blocks : text });
    }
  }
  // Anthropic requires alternating turns starting with user; merge consecutive same-role messages
  const merged: { role: "user" | "assistant"; content: unknown }[] = [];
  for (const m of messages) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === m.role) {
      const a = Array.isArray(prev.content) ? prev.content : [{ type: "text", text: String(prev.content) }];
      const b = Array.isArray(m.content) ? m.content : [{ type: "text", text: String(m.content) }];
      prev.content = [...a, ...b];
    } else {
      merged.push({ ...m });
    }
  }
  return { system: systemParts.filter(Boolean).join("\n\n") || undefined, messages: merged };
}

function safeJson(value: unknown): unknown {
  if (typeof value !== "string") return value ?? {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function finishMap(reason: string | null | undefined): string | null {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return "stop";
    case "max_tokens":
      return "length";
    case "tool_use":
      return "tool_calls";
    default:
      return reason ?? null;
  }
}

function toOpenAIResponse(json: any, fallbackModel: string): OpenAIResponse {
  const text = (json.content ?? [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("");
  const toolCalls = (json.content ?? [])
    .filter((b: any) => b.type === "tool_use")
    .map((b: any) => ({
      id: b.id,
      type: "function",
      function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
    }));
  return {
    id: json.id ?? `msg-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: fallbackModel,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: text || null,
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: finishMap(json.stop_reason),
      },
    ],
    usage: {
      prompt_tokens: json.usage?.input_tokens,
      completion_tokens: json.usage?.output_tokens,
      total_tokens:
        (json.usage?.input_tokens ?? 0) + (json.usage?.output_tokens ?? 0) || undefined,
    },
  };
}

export class AnthropicAdapter implements ProviderAdapter {
  type = "anthropic" as const;

  private endpoint(provider: ResolvedProvider): string {
    const base = provider.base_url || "https://api.anthropic.com";
    return base.endsWith("/messages") ? base : joinUrl(base, base.endsWith("/v1") ? "/messages" : "/v1/messages");
  }

  private headers(provider: ResolvedProvider): Record<string, string> {
    return {
      "content-type": "application/json",
      "x-api-key": provider.api_key,
      authorization: `Bearer ${provider.api_key}`,
      "anthropic-version": ANTHROPIC_VERSION,
    };
  }

  private buildBody(req: CanonicalRequest, stream: boolean): Record<string, unknown> {
    const { system, messages } = convertMessages(req);
    const body: Record<string, unknown> = {
      model: req.model,
      messages,
      max_tokens: req.max_tokens ?? 4096,
      stream,
    };
    if (system) body.system = system;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.top_p !== undefined) body.top_p = req.top_p;
    if (req.stop !== undefined) {
      body.stop_sequences = Array.isArray(req.stop) ? req.stop : [req.stop];
    }
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters ?? { type: "object", properties: {} },
      }));
    }
    if (req.tool_choice && typeof req.tool_choice === "object") {
      const tc = req.tool_choice as any;
      if (tc.type === "function" || tc.function?.name) {
        body.tool_choice = { type: "tool", name: tc.function?.name ?? tc.name };
      } else if (tc.type === "any" || tc.type === "auto") {
        body.tool_choice = { type: tc.type };
      }
    }
    // capability mapping: response_format (json_mode) is not supported upstream -> drop it
    return body;
  }

  async send(provider: ResolvedProvider, req: CanonicalRequest, signal: AbortSignal): Promise<OpenAIResponse> {
    const res = await upstreamFetch(
      this.endpoint(provider),
      { method: "POST", headers: this.headers(provider), body: JSON.stringify(this.buildBody(req, false)) },
      signal
    );
    if (!res.ok) {
      throw new AdapterError(`Upstream returned ${res.status}`, {
        status: res.status,
        body: await readErrorBody(res),
      });
    }
    return toOpenAIResponse(await res.json(), req.model);
  }

  async *stream(
    provider: ResolvedProvider,
    req: CanonicalRequest,
    signal: AbortSignal
  ): AsyncGenerator<OpenAIChunk, StreamResult, void> {
    const res = await upstreamFetch(
      this.endpoint(provider),
      { method: "POST", headers: this.headers(provider), body: JSON.stringify(this.buildBody(req, true)) },
      signal
    );
    if (!res.ok || !res.body) {
      throw new AdapterError(`Upstream returned ${res.status}`, {
        status: res.status,
        body: await readErrorBody(res),
      });
    }

    const id = `chatcmpl-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    let content = "";
    let finishReason: string | null = null;
    let inputTokens = 0;
    let outputTokens = 0;
    const toolCalls: any[] = [];
    let toolIndex = -1;
    let gotMessageStop = false;

    const makeChunk = (delta: Record<string, unknown>, finish: string | null): OpenAIChunk => ({
      id,
      object: "chat.completion.chunk",
      created,
      model: req.model,
      choices: [{ index: 0, delta: delta as any, finish_reason: finish }],
    });

    for await (const payload of sseLines(res.body, signal)) {
      let event: any;
      try {
        event = JSON.parse(payload);
      } catch {
        continue;
      }
      switch (event.type) {
        case "message_start": {
          const u = event.message?.usage;
          if (u) inputTokens = u.input_tokens ?? 0;
          yield makeChunk({ role: "assistant", content: "" }, null);
          break;
        }
        case "content_block_start": {
          if (event.content_block?.type === "tool_use") {
            toolIndex += 1;
            toolCalls[toolIndex] = {
              id: event.content_block.id,
              type: "function",
              function: { name: event.content_block.name, arguments: "" },
            };
          }
          break;
        }
        case "content_block_delta": {
          const delta = event.delta;
          if (delta?.type === "text_delta") {
            content += delta.text ?? "";
            yield makeChunk({ content: delta.text ?? "" }, null);
          } else if (delta?.type === "input_json_delta" && toolIndex >= 0) {
            toolCalls[toolIndex].function.arguments += delta.partial_json ?? "";
          } else if (delta?.type === "text_stop") {
            /* ignore */
          }
          break;
        }
        case "content_block_stop":
          break;
        case "message_delta": {
          if (event.delta?.stop_reason) finishReason = finishMap(event.delta.stop_reason);
          if (event.usage?.output_tokens !== undefined) {
            outputTokens = event.usage.output_tokens;
          }
          break;
        }
        case "message_stop":
          gotMessageStop = true;
          break;
        case "error":
          throw new AdapterError(event.error?.message ?? "Upstream stream error", { status: 500 });
        default:
          break; // ping, etc.
      }
      if (gotMessageStop) break;
    }

    if (!gotMessageStop) {
      throw new AdapterError("Upstream stream closed unexpectedly", { code: "connection" });
    }
    yield makeChunk({}, finishReason ?? "stop");
    return {
      content,
      finish_reason: finishReason ?? "stop",
      usage: inputTokens || outputTokens
        ? {
            prompt_tokens: inputTokens,
            completion_tokens: outputTokens,
            total_tokens: inputTokens + outputTokens,
          }
        : null,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    };
  }

  async test(provider: ResolvedProvider, signal: AbortSignal): Promise<TestResult> {
    const started = Date.now();
    try {
      const res = await upstreamFetch(
        this.endpoint(provider),
        {
          method: "POST",
          headers: this.headers(provider),
          body: JSON.stringify({
            model: provider.upstream_model,
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 1,
          }),
        },
        signal
      );
      const latency = Date.now() - started;
      if (!res.ok) {
        return { ok: false, latency_ms: latency, error: `HTTP ${res.status}: ${(await readErrorBody(res)).slice(0, 200)}` };
      }
      const json = (await res.json()) as { model?: string };
      return { ok: true, latency_ms: latency, model: json.model ?? provider.upstream_model };
    } catch (err) {
      return { ok: false, latency_ms: Date.now() - started, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** GET /v1/models — Anthropic List Models API (paginated). */
  async listModels(provider: ResolvedProvider, signal: AbortSignal): Promise<string[]> {
    const base = provider.base_url || "https://api.anthropic.com";
    const root = base.endsWith("/models")
      ? base
      : base.endsWith("/v1")
        ? `${base}/models`
        : joinUrl(base, "/v1/models");
    const ids: string[] = [];
    let afterId: string | undefined;
    for (let page = 0; page < 5; page++) {
      const url = `${root}?limit=1000${afterId ? `&after_id=${encodeURIComponent(afterId)}` : ""}`;
      const res = await upstreamFetch(url, { headers: this.headers(provider) }, signal);
      if (!res.ok) {
        throw new AdapterError(`List models returned ${res.status}`, {
          status: res.status,
          body: await readErrorBody(res),
        });
      }
      const json = (await res.json()) as { data?: { id?: string }[]; has_more?: boolean; last_id?: string };
      for (const m of json.data ?? []) if (m?.id) ids.push(m.id);
      if (!json.has_more || !json.last_id) break;
      afterId = json.last_id;
    }
    if (!ids.length) throw new AdapterError("Provider returned an empty model list");
    return ids;
  }
}
