import type {
  CanonicalRequest,
  OpenAIChunk,
  OpenAIResponse,
  ProviderType,
  ResolvedProvider,
  StreamResult,
} from "../types.js";
import { AdapterError } from "../types.js";
import type { ProviderAdapter, TestResult } from "./types.js";
import { joinUrl, readErrorBody, sseLines, upstreamFetch } from "./http.js";

function buildBody(req: CanonicalRequest): Record<string, unknown> {
  const body: Record<string, unknown> = { model: req.model, messages: req.messages };
  for (const key of [
    "temperature",
    "top_p",
    "max_tokens",
    "stream",
    "tools",
    "tool_choice",
    "response_format",
    "stop",
    "stream_options",
  ]) {
    if (req[key] !== undefined) body[key] = req[key];
  }
  // pass through any other client-provided OpenAI params (frequency_penalty, seed, ...)
  for (const [k, v] of Object.entries(req)) {
    if (
      !["model", "messages", "stream", "external_model", "conversation_id"].includes(k) &&
      body[k] === undefined &&
      v !== undefined
    ) {
      body[k] = v;
    }
  }
  return body;
}

function normalizeResponse(json: unknown, fallbackModel: string): OpenAIResponse {
  const obj = json as Partial<OpenAIResponse> & { error?: { message?: string } };
  if (obj?.error) throw new AdapterError(obj.error.message ?? "Upstream error", { status: 400 });
  if (!obj || !Array.isArray(obj.choices)) {
    throw new AdapterError("Malformed upstream response", { body: JSON.stringify(json).slice(0, 300) });
  }
  return {
    id: obj.id ?? `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: obj.created ?? Math.floor(Date.now() / 1000),
    model: obj.model ?? fallbackModel,
    choices: obj.choices,
    usage: obj.usage ?? null,
  };
}

export class OpenAICompatibleAdapter implements ProviderAdapter {
  constructor(
    public type: ProviderType,
    private opts: { defaultBaseUrl?: string; includeUsageOption?: boolean } = {}
  ) {}

  private endpoint(provider: ResolvedProvider): string {
    return joinUrl(provider.base_url || this.opts.defaultBaseUrl || "", "/chat/completions");
  }

  private headers(provider: ResolvedProvider): Record<string, string> {
    return {
      "content-type": "application/json",
      authorization: `Bearer ${provider.api_key}`,
    };
  }

  async send(
    provider: ResolvedProvider,
    req: CanonicalRequest,
    signal: AbortSignal
  ): Promise<OpenAIResponse> {
    const res = await upstreamFetch(
      this.endpoint(provider),
      {
        method: "POST",
        headers: this.headers(provider),
        body: JSON.stringify(buildBody({ ...req, stream: false })),
      },
      signal
    );
    if (!res.ok) {
      throw new AdapterError(`Upstream returned ${res.status}`, {
        status: res.status,
        body: await readErrorBody(res),
      });
    }
    return normalizeResponse(await res.json(), req.model);
  }

  async *stream(
    provider: ResolvedProvider,
    req: CanonicalRequest,
    signal: AbortSignal
  ): AsyncGenerator<OpenAIChunk, StreamResult, void> {
    const body = buildBody({ ...req, stream: true });
    if (this.opts.includeUsageOption) body.stream_options = { include_usage: true };

    const res = await upstreamFetch(
      this.endpoint(provider),
      { method: "POST", headers: this.headers(provider), body: JSON.stringify(body) },
      signal
    );
    if (!res.ok || !res.body) {
      throw new AdapterError(`Upstream returned ${res.status}`, {
        status: res.status,
        body: await readErrorBody(res),
      });
    }

    let content = "";
    let finishReason: string | null = null;
    let usage: StreamResult["usage"] = null;
    let gotDone = false;

    for await (const payload of sseLines(res.body, signal)) {
      if (payload === "[DONE]") {
        gotDone = true;
        break;
      }
      let chunk: OpenAIChunk & { error?: { message?: string } };
      try {
        chunk = JSON.parse(payload);
      } catch {
        continue;
      }
      if (chunk.error) {
        throw new AdapterError(chunk.error.message ?? "Upstream stream error", { status: 500 });
      }
      if (!chunk.choices && chunk.usage) usage = chunk.usage;
      for (const choice of chunk.choices ?? []) {
        if (choice.delta?.content) content += choice.delta.content;
        if (choice.finish_reason) finishReason = choice.finish_reason;
      }
      if (chunk.usage) usage = chunk.usage;
      yield chunk;
    }

    if (!gotDone) {
      throw new AdapterError("Upstream stream closed unexpectedly", { code: "connection" });
    }
    return { content, finish_reason: finishReason, usage };
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

  /** GET {base}/models — OpenAI-style model listing. */
  async listModels(provider: ResolvedProvider, signal: AbortSignal): Promise<string[]> {
    const base = provider.base_url || this.opts.defaultBaseUrl || "";
    const res = await upstreamFetch(joinUrl(base, "/models"), { headers: this.headers(provider) }, signal);
    if (!res.ok) {
      throw new AdapterError(`GET /models returned ${res.status}`, {
        status: res.status,
        body: await readErrorBody(res),
      });
    }
    const json = (await res.json()) as { data?: { id?: string }[]; models?: { id?: string }[] };
    const list = json.data ?? json.models ?? [];
    const ids = list.map((m) => m?.id).filter((id): id is string => typeof id === "string" && id.length > 0);
    if (!ids.length) throw new AdapterError("Provider returned an empty model list");
    return ids;
  }
}
