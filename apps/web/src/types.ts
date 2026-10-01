export type ProviderStatus =
  | "online"
  | "rate_limited"
  | "cooling"
  | "error"
  | "disabled"
  | "unknown";

export interface Provider {
  id: number;
  model_id: number;
  model_name: string;
  name: string;
  type: "openai" | "anthropic" | "openai-compatible" | "gemini";
  base_url: string;
  upstream_model: string;
  priority: number;
  enabled: number;
  status: ProviderStatus;
  last_error: string | null;
  cooldown_until: number | null;
  api_key_masked: string;
  requests: number;
  failures: number;
}

export interface Model {
  id: number;
  name: string;
  input_cost: number;
  output_cost: number;
  aliases: string[];
  providers: Provider[];
  provider_count?: number;
  healthy_count?: number;
}

export interface LogEntry {
  request_id: string;
  model: string;
  provider_name: string | null;
  status: number | null;
  ok: number;
  streaming: number;
  duration_ms: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cost: number | null;
  error: string | null;
  failover: { provider: string; status: number | string }[] | null;
  created_at: number;
}

export interface Settings {
  routing_strategy: "round_robin" | "priority" | "least_used";
  retry_count: number;
  timeout_ms: number;
  cooldown_429_ms: number;
  cooldown_5xx_ms: number;
  cooldown_timeout_ms: number;
  rate_limit_rpm: number;
  default_model: string;
  /** "0" = off; background provider health-check interval. */
  health_check_interval_ms?: string;
}

export interface ApiKey {
  id: number;
  name: string;
  prefix: string;
  created_at: number;
  last_used_at: number | null;
  revoked: number;
}

export interface ActivityDay {
  date: string;
  requests: number;
  successful: number;
  tokens_in: number;
  tokens_out: number;
  tokens: number;
  cost: number;
}

export interface ActivityResponse {
  days: ActivityDay[];
  totals: {
    requests: number;
    successful: number;
    tokens_in: number;
    tokens_out: number;
    tokens: number;
    cost: number;
    active_days: number;
    max_tokens: number;
  };
}

export interface Stats {
  range: string;
  requests: number;
  successful: number;
  failed: number;
  tokens_in: number;
  tokens_out: number;
  cost: number;
  providers: {
    provider_id: number;
    provider_name: string;
    requests: number;
    successful: number;
    failed: number;
    tokens_in: number;
    tokens_out: number;
    cost: number;
  }[];
}

export interface OverviewResponse {
  status: string;
  models: Model[];
  recent: LogEntry[];
  /** Last 5 failed requests, newest first. */
  errors: LogEntry[];
  /** True when at least one non-revoked router API key exists. */
  has_api_key: boolean;
}

/* ------------------------------------------------------------------ */
/* Playground                                                          */
/* ------------------------------------------------------------------ */

export type PlaygroundRole = "user" | "assistant" | "system";

export interface PlaygroundMessage {
  role: PlaygroundRole;
  content: string;
}

export interface PlaygroundAttempt {
  provider: string;
  status: number | string;
}

export interface PlaygroundUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface PlaygroundMeta {
  provider_name: string;
  provider_id: number | null;
  attempts: PlaygroundAttempt[];
  duration_ms: number;
  usage: PlaygroundUsage | null;
  conversation_id: string;
}

export interface PlaygroundRequest {
  model: string;
  messages: PlaygroundMessage[];
  stream?: boolean;
}

/** One `chat.completion.chunk` payload from the SSE stream. */
export interface ChatCompletionChunk {
  choices?: {
    index?: number;
    delta?: { role?: string; content?: string | null };
    finish_reason?: string | null;
  }[];
  usage?: PlaygroundUsage | null;
  /** Final chunk-only payload carrying routing metadata. */
  __mixroute_meta?: PlaygroundMeta;
}

/* ------------------------------------------------------------------ */
/* Config export / import                                              */
/* ------------------------------------------------------------------ */

export interface ExportProvider {
  name: string;
  type: Provider["type"];
  base_url: string;
  upstream_model: string;
  priority: number;
  enabled: number;
}

export interface ExportModel {
  name: string;
  input_cost: number;
  output_cost: number;
  aliases: string[];
  providers: ExportProvider[];
}

/** Export payload — never contains provider API keys. */
export interface ExportConfig {
  version: number;
  exported_at?: number;
  settings: Record<string, string>;
  models: ExportModel[];
}

export type ImportMode = "merge" | "replace";

export interface ImportResponse {
  ok: boolean;
  imported: { models: number; providers: number };
  errors: string[];
}
