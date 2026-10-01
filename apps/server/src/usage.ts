import type { Db } from "./db.js";
import type { Attempt } from "./router.js";
import type { CanonicalMessage, Usage } from "./types.js";

/**
 * Rough token estimate (chars / 4) used ONLY when the provider does not
 * return usage. Deliberately simple: good enough for activity stats without
 * shipping a tokenizer.
 */
export function estimateUsage(promptChars: number, completionChars: number): Usage {
  const prompt_tokens = Math.ceil(promptChars / 4);
  const completion_tokens = Math.ceil(completionChars / 4);
  return { prompt_tokens, completion_tokens, total_tokens: prompt_tokens + completion_tokens };
}

export function promptChars(messages: CanonicalMessage[]): number {
  try {
    return JSON.stringify(messages).length;
  } catch {
    return 0;
  }
}

export interface RequestRecord {
  request_id: string;
  conversation_id: string | null;
  model: string;
  provider_id: number | null;
  provider_name: string | null;
  status: number;
  ok: boolean;
  streaming: boolean;
  duration_ms: number;
  usage: Usage | null;
  error?: string | null;
  attempts?: Attempt[];
}

export function estimateCost(db: Db, model: string, usage: Usage | null): number {
  if (!usage) return 0;
  const row = db.prepare("SELECT input_cost, output_cost FROM models WHERE name = ?").get(model) as
    | { input_cost: number; output_cost: number }
    | undefined;
  if (!row) return 0;
  const inTokens = usage.prompt_tokens ?? 0;
  const outTokens = usage.completion_tokens ?? 0;
  return (inTokens / 1_000_000) * row.input_cost + (outTokens / 1_000_000) * row.output_cost;
}

export function recordRequest(db: Db, rec: RequestRecord): void {
  db.prepare(
    `INSERT OR REPLACE INTO requests
     (request_id, conversation_id, model, provider_id, provider_name, status, ok, streaming,
      duration_ms, tokens_in, tokens_out, cost, error, failover, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    rec.request_id,
    rec.conversation_id,
    rec.model,
    rec.provider_id ?? null,
    rec.provider_name ?? null,
    rec.status,
    rec.ok ? 1 : 0,
    rec.streaming ? 1 : 0,
    rec.duration_ms,
    rec.usage?.prompt_tokens ?? null,
    rec.usage?.completion_tokens ?? null,
    estimateCost(db, rec.model, rec.usage),
    rec.error ? rec.error.slice(0, 1000) : null,
    rec.attempts?.length ? JSON.stringify(rec.attempts) : null,
    Date.now()
  );
}
