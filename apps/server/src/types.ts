/** Canonical (provider-independent) request/response model. */

export type Role = "system" | "user" | "assistant" | "tool";

/** OpenAI-style message; content is a string or array of content parts. */
export interface CanonicalMessage {
  role: Role;
  content: unknown;
  name?: string;
  tool_calls?: unknown[];
  tool_call_id?: string;
}

export interface CanonicalTool {
  type: "function";
  function: { name: string; description?: string; parameters?: unknown };
}

export interface CanonicalRequest {
  /** Upstream model name — filled in by the router per provider. */
  model: string;
  messages: CanonicalMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stream?: boolean;
  tools?: CanonicalTool[];
  tool_choice?: unknown;
  response_format?: unknown;
  stop?: string | string[];
  [extra: string]: unknown;
}

export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface OpenAIChunkChoice {
  index: number;
  delta: { role?: string; content?: string | null; tool_calls?: unknown[] };
  finish_reason: string | null;
}

export interface OpenAIChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: OpenAIChunkChoice[];
  usage?: Usage | null;
}

export interface OpenAIResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: {
    index: number;
    message: { role: "assistant"; content: string | null; tool_calls?: unknown[] };
    finish_reason: string | null;
  }[];
  usage?: Usage | null;
}

/** What an adapter's stream() returns when the generator completes. */
export interface StreamResult {
  content: string;
  finish_reason: string | null;
  usage: Usage | null;
  tool_calls?: unknown[];
}

export type ProviderType = "openai" | "anthropic" | "openai-compatible" | "gemini";

export interface ResolvedProvider {
  id: number;
  name: string;
  type: ProviderType;
  base_url: string;
  api_key: string;
  upstream_model: string;
}

export class AdapterError extends Error {
  status?: number;
  code?: "timeout" | "connection" | "invalid";
  body?: string;

  constructor(
    message: string,
    opts: { status?: number; code?: "timeout" | "connection" | "invalid"; body?: string } = {}
  ) {
    super(message);
    this.name = "AdapterError";
    this.status = opts.status;
    this.code = opts.code;
    this.body = opts.body;
  }
}
