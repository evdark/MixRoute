import type { Db } from "./db.js";
import { getNumericSetting, getSetting } from "./db.js";
import { decryptSecret } from "./crypto.js";
import {
  getHealth,
  isCooling,
  markFailure,
  markSuccess,
  tryClaimProbe,
  type HealthRow,
} from "./health.js";
import { getAdapter } from "./adapters/registry.js";
import type {
  CanonicalRequest,
  OpenAIChunk,
  OpenAIResponse,
  ProviderType,
  ResolvedProvider,
} from "./types.js";
import { AdapterError } from "./types.js";

export type RoutingStrategy = "round_robin" | "priority" | "least_used";

export interface ProviderRow {
  id: number;
  model_id: number;
  name: string;
  type: ProviderType;
  base_url: string;
  api_key_enc: string;
  upstream_model: string;
  priority: number;
  enabled: number;
  created_at: number;
}

export interface Candidate {
  row: ProviderRow;
  provider: ResolvedProvider;
  health: HealthRow;
}

export interface Attempt {
  provider: string;
  status: number | string;
}

export interface MakeRequestOptions {
  /** Retry without parameters some providers commonly reject (400/422). */
  degraded?: boolean;
}

export type MakeRequestFn = (
  provider: ResolvedProvider,
  opts?: MakeRequestOptions
) => CanonicalRequest;

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

// round-robin cursors, in-memory per process
const rrCursor = new Map<string, number>();

export function resolveProvider(row: ProviderRow): ResolvedProvider {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    base_url: row.base_url,
    api_key: decryptSecret(row.api_key_enc),
    upstream_model: row.upstream_model,
  };
}

function byStrategy(strategy: RoutingStrategy, model: string, candidates: Candidate[]): Candidate[] {
  const byPriority = (a: Candidate, b: Candidate) =>
    a.row.priority - b.row.priority ||
    a.health.requests - b.health.requests ||
    a.row.id - b.row.id;

  if (strategy === "priority") return [...candidates].sort(byPriority);

  if (strategy === "least_used")
    return [...candidates].sort(
      (a, b) => a.health.requests - b.health.requests || byPriority(a, b)
    );

  // round_robin over a STABLE base order (priority then id) — request counters
  // must not reshuffle the ring, otherwise distribution drifts
  const base = [...candidates].sort(
    (a, b) => a.row.priority - b.row.priority || a.row.id - b.row.id
  );
  const key = `${model}`;
  const cursor = rrCursor.get(key) ?? 0;
  rrCursor.set(key, cursor + 1);
  if (base.length === 0) return base;
  const offset = cursor % base.length;
  return [...base.slice(offset), ...base.slice(0, offset)];
}

/**
 * Ordered failover chain for a logical model:
 *   1. half-open probes (cooldown expired — one request proves the provider back),
 *   2. healthy providers per strategy,
 *   3. cooling-down providers (soonest first) as a last resort,
 *   4. unclaimed probes (only if nothing else is available).
 * Disabled providers are never included.
 */
export function selectCandidates(db: Db, model: string): Candidate[] {
  const strategy = getSetting(db, "routing_strategy") as RoutingStrategy;
  const rows = db
    .prepare("SELECT * FROM providers WHERE model_id = (SELECT id FROM models WHERE name = ?)")
    .all(model) as ProviderRow[];

  const now = Date.now();
  const withHealth = rows.map((row) => ({
    row,
    provider: resolveProvider(row),
    health: getHealth(db, row.id),
  }));

  const probes: Candidate[] = [];
  const healthy: Candidate[] = [];
  const cooling: Candidate[] = [];
  const unclaimed: Candidate[] = [];

  for (const c of withHealth) {
    if (!c.row.enabled) continue;
    if (isCooling(c.health, now)) {
      cooling.push(c);
    } else if (c.health.probe_pending) {
      (tryClaimProbe(c.row.id, now) ? probes : unclaimed).push(c);
    } else {
      healthy.push(c);
    }
  }
  cooling.sort((a, b) => (a.health.cooldown_until ?? 0) - (b.health.cooldown_until ?? 0));

  return [
    ...probes,
    ...byStrategy(strategy, model, healthy),
    ...cooling,
    ...unclaimed,
  ];
}

interface FailureClass {
  retryable: boolean;
  status: "rate_limited" | "error";
  cooldownMs: number;
}

export function classifyFailure(db: Db, err: unknown): FailureClass {
  const cooldown429 = getNumericSetting(db, "cooldown_429_ms");
  const cooldown5xx = getNumericSetting(db, "cooldown_5xx_ms");
  const cooldownTimeout = getNumericSetting(db, "cooldown_timeout_ms");
  const cooldownAuth = getNumericSetting(db, "cooldown_auth_ms");

  if (err instanceof AdapterError) {
    if (err.code === "timeout") return { retryable: true, status: "error", cooldownMs: cooldownTimeout };
    if (err.code === "connection")
      return { retryable: true, status: "error", cooldownMs: cooldownTimeout };
    const s = err.status ?? 500;
    if (s === 429) return { retryable: true, status: "rate_limited", cooldownMs: cooldown429 };
    if (s === 401 || s === 403) return { retryable: true, status: "error", cooldownMs: cooldownAuth };
    if (s === 408 || s >= 500) return { retryable: true, status: "error", cooldownMs: cooldown5xx };
    return { retryable: false, status: "error", cooldownMs: 0 };
  }
  return { retryable: true, status: "error", cooldownMs: cooldown5xx };
}

/** 400/422 usually mean "unsupported parameter" — worth one degraded retry. */
function isBadParams(err: unknown): boolean {
  return err instanceof AdapterError && (err.status === 400 || err.status === 422);
}

function maxAttempts(db: Db, chainLength: number): number {
  const retry = getNumericSetting(db, "retry_count");
  return Math.max(1, Math.min(chainLength, 1 + retry));
}

function errorMessage(err: unknown): string {
  if (err instanceof AdapterError) {
    const parts = [err.message];
    if (err.status) parts.unshift(`[${err.status}]`);
    if (err.body) parts.push(err.body);
    return parts.join(" ");
  }
  return err instanceof Error ? err.message : String(err);
}

export function errorStatus(err: unknown): number {
  if (err instanceof HttpError) return err.statusCode;
  if (err instanceof AdapterError && err.status && err.status >= 400 && err.status < 500)
    return err.status;
  if (err instanceof AdapterError && (err.code === "timeout" || err.code === "connection")) return 504;
  return 502;
}

function attemptStatus(err: unknown): number | string {
  if (err instanceof AdapterError) return err.status ?? err.code ?? "error";
  return "error";
}

/** Per-attempt timeout linked to the outer (client) signal. */
function attemptSignal(timeoutMs: number, outer: AbortSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  outer.addEventListener("abort", onAbort);
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      outer.removeEventListener("abort", onAbort);
    },
  };
}

function timeoutMs(db: Db): number {
  return getNumericSetting(db, "timeout_ms");
}

export interface SendOutcome {
  response: OpenAIResponse;
  provider: Candidate;
  attempts: Attempt[];
  durationMs: number;
}

async function oneSend(
  db: Db,
  model: string,
  candidate: Candidate,
  makeRequest: MakeRequestFn,
  reqOpts: MakeRequestOptions | undefined,
  outerSignal: AbortSignal
): Promise<{ response?: OpenAIResponse; error?: unknown }> {
  const { signal, dispose } = attemptSignal(timeoutMs(db), outerSignal);
  try {
    const adapter = getAdapter(candidate.row.type);
    const response = await adapter.send(candidate.provider, makeRequest(candidate.provider, reqOpts), signal);
    response.model = model; // external model name, never the upstream one
    return { response };
  } catch (err) {
    return { error: err };
  } finally {
    dispose();
  }
}

/** Non-streaming request with routing, failover, retries and 400-degradation. */
export async function sendWithFailover(
  db: Db,
  model: string,
  makeRequest: MakeRequestFn,
  outerSignal: AbortSignal
): Promise<SendOutcome> {
  const chain = selectCandidates(db, model);
  if (!chain.length) {
    throw new HttpError(503, `No providers configured for model "${model}"`, "no_providers");
  }

  const attempts: Attempt[] = [];
  const limit = maxAttempts(db, chain.length);
  const started = Date.now();
  const degraded = new Set<number>();
  let lastError: unknown = new HttpError(503, "No providers available", "no_providers");

  for (const candidate of chain.slice(0, limit)) {
    let result = await oneSend(db, model, candidate, makeRequest, undefined, outerSignal);

    // unsupported-parameter fallback: same provider, stripped params, once
    if (result.error && isBadParams(result.error) && !degraded.has(candidate.row.id)) {
      degraded.add(candidate.row.id);
      result = await oneSend(db, model, candidate, makeRequest, { degraded: true }, outerSignal);
    }

    if (result.response) {
      markSuccess(db, candidate.row.id);
      return { response: result.response, provider: candidate, attempts, durationMs: Date.now() - started };
    }

    // client went away mid-request: don't penalize the provider
    if (outerSignal.aborted) {
      throw new HttpError(499, "Client disconnected", "client_disconnected");
    }

    const cls = classifyFailure(db, result.error);
    attempts.push({ provider: candidate.row.name, status: attemptStatus(result.error) });
    markFailure(db, candidate.row.id, {
      status: cls.status,
      cooldownMs: cls.cooldownMs,
      error: errorMessage(result.error),
    });
    lastError = result.error;
    if (!cls.retryable) break;
    if (outerSignal.aborted) break;
  }
  throw lastError;
}

export interface StreamOutcome {
  provider: Candidate;
  attempts: Attempt[];
  content: string;
  finish_reason: string | null;
  usage: OpenAIResponse["usage"];
  tool_calls?: unknown[];
}

/**
 * Streaming with failover. Failover (and 400-degradation) is ONLY attempted
 * before the first chunk has been forwarded to the client — once the SSE
 * stream started we must never silently replay (text duplication risk).
 */
export async function* streamWithFailover(
  db: Db,
  model: string,
  makeRequest: MakeRequestFn,
  outerSignal: AbortSignal
): AsyncGenerator<{ chunk: OpenAIChunk; provider: Candidate; attempts: Attempt[] }, StreamOutcome, void> {
  const chain = selectCandidates(db, model);
  if (!chain.length) {
    throw new HttpError(503, `No providers configured for model "${model}"`, "no_providers");
  }

  const attempts: Attempt[] = [];
  const limit = maxAttempts(db, chain.length);
  const degraded = new Set<number>();
  let lastError: unknown = new HttpError(503, "No providers available", "no_providers");

  for (const candidate of chain.slice(0, limit)) {
    let useDegraded = false;
    // inner loop: one possible degraded retry on 400/422, before any chunk was sent
    for (;;) {
      const { signal, dispose } = attemptSignal(timeoutMs(db), outerSignal);
      let startedStreaming = false;
      let failure: unknown = null;
      try {
        const adapter = getAdapter(candidate.row.type);
        const gen = adapter.stream(
          candidate.provider,
          makeRequest(candidate.provider, useDegraded ? { degraded: true } : undefined),
          signal
        );

        while (true) {
          const next = await gen.next();
          if (next.done) {
            markSuccess(db, candidate.row.id);
            dispose();
            const result = next.value;
            return {
              provider: candidate,
              attempts,
              content: result.content,
              finish_reason: result.finish_reason,
              usage: (result.usage as OpenAIResponse["usage"]) ?? null,
              tool_calls: result.tool_calls,
            };
          }
          startedStreaming = true;
          next.value.model = model;
          yield { chunk: next.value, provider: candidate, attempts };
        }
      } catch (err) {
        failure = err;
      } finally {
        dispose();
      }

      // client went away mid-request: don't penalize the provider
      if (outerSignal.aborted) {
        throw new HttpError(499, "Client disconnected", "client_disconnected");
      }

      // never fail over (or retry) after chunks reached the client
      if (startedStreaming) throw failure;

      if (isBadParams(failure) && !degraded.has(candidate.row.id)) {
        degraded.add(candidate.row.id);
        useDegraded = true;
        continue; // same provider, stripped params
      }

      const cls = classifyFailure(db, failure);
      attempts.push({ provider: candidate.row.name, status: attemptStatus(failure) });
      markFailure(db, candidate.row.id, {
        status: cls.status,
        cooldownMs: cls.cooldownMs,
        error: errorMessage(failure),
      });
      lastError = failure;
      if (!cls.retryable || outerSignal.aborted) throw failure;
      break; // next candidate
    }
  }
  throw lastError;
}
