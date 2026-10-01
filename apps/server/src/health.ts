import type { Db } from "./db.js";
import type { ProviderStatus } from "./status.js";

export interface HealthRow {
  provider_id: number;
  status: ProviderStatus;
  cooldown_until: number | null;
  last_error: string | null;
  last_checked_at: number | null;
  requests: number;
  failures: number;
  probe_pending: number;
}

function ensureRow(db: Db, providerId: number): void {
  db.prepare(
    "INSERT INTO provider_health (provider_id) VALUES (?) ON CONFLICT(provider_id) DO NOTHING"
  ).run(providerId);
}

export function getHealth(db: Db, providerId: number): HealthRow {
  ensureRow(db, providerId);
  return db.prepare("SELECT * FROM provider_health WHERE provider_id = ?").get(providerId) as HealthRow;
}

export function isCooling(row: HealthRow, now = Date.now()): boolean {
  return row.cooldown_until != null && row.cooldown_until > now;
}

// ---------------------------------------------------------------------------
// Half-open circuit breaker: after a cooldown expires the provider must pass
// ONE probe request before rejoining the full rotation. Claims are in-memory
// (per process) so concurrent requests never double-probe.
// ---------------------------------------------------------------------------

const PROBE_TTL_MS = 15_000;
const probeClaims = new Map<number, number>();

/** Returns true if this process may send the probe right now. */
export function tryClaimProbe(providerId: number, now = Date.now()): boolean {
  const expiry = probeClaims.get(providerId);
  if (expiry && expiry > now) return false;
  probeClaims.set(providerId, now + PROBE_TTL_MS);
  return true;
}

export function releaseProbe(providerId: number): void {
  probeClaims.delete(providerId);
}

export function markSuccess(db: Db, providerId: number): void {
  ensureRow(db, providerId);
  releaseProbe(providerId);
  db.prepare(
    `UPDATE provider_health
     SET status = 'online', cooldown_until = NULL, last_error = NULL,
         last_checked_at = ?, probe_pending = 0, requests = requests + 1
     WHERE provider_id = ?`
  ).run(Date.now(), providerId);
}

export function markFailure(
  db: Db,
  providerId: number,
  opts: { status: ProviderStatus; cooldownMs: number; error: string }
): void {
  ensureRow(db, providerId);
  releaseProbe(providerId);
  db.prepare(
    `UPDATE provider_health
     SET status = ?, cooldown_until = ?, last_error = ?, last_checked_at = ?,
         probe_pending = CASE WHEN ? > 0 THEN 1 ELSE probe_pending END,
         requests = requests + 1, failures = failures + 1
     WHERE provider_id = ?`
  ).run(
    opts.status,
    opts.cooldownMs > 0 ? Date.now() + opts.cooldownMs : null,
    opts.error.slice(0, 500),
    Date.now(),
    opts.cooldownMs,
    providerId
  );
}

/**
 * Record a background health-check result WITHOUT touching request counters
 * (a ping is not a routed request).
 */
export function recordHealthPing(
  db: Db,
  providerId: number,
  opts: { ok: boolean; status: ProviderStatus; error?: string; cooldownMs?: number }
): void {
  ensureRow(db, providerId);
  releaseProbe(providerId);
  const now = Date.now();
  if (opts.ok) {
    db.prepare(
      `UPDATE provider_health
       SET status = 'online', cooldown_until = NULL, last_error = NULL,
           last_checked_at = ?, probe_pending = 0
       WHERE provider_id = ?`
    ).run(now, providerId);
    return;
  }
  const cooldownMs = opts.cooldownMs ?? 0;
  db.prepare(
    `UPDATE provider_health
     SET status = ?, cooldown_until = ?, last_error = ?, last_checked_at = ?,
         probe_pending = CASE WHEN ? > 0 THEN 1 ELSE probe_pending END
     WHERE provider_id = ?`
  ).run(
    opts.status,
    cooldownMs > 0 ? now + cooldownMs : null,
    (opts.error ?? "health check failed").slice(0, 500),
    now,
    cooldownMs,
    providerId
  );
}

export function clearCooldown(db: Db, providerId: number): void {
  ensureRow(db, providerId);
  releaseProbe(providerId);
  db.prepare(
    "UPDATE provider_health SET cooldown_until = NULL, probe_pending = 0 WHERE provider_id = ?"
  ).run(providerId);
}

/** Effective display status, taking enabled flag and cooldown into account. */
export function effectiveStatus(
  enabled: number,
  row: HealthRow,
  now = Date.now()
): ProviderStatus {
  if (!enabled) return "disabled";
  if (isCooling(row, now)) return row.status === "rate_limited" ? "rate_limited" : "cooling";
  if (row.status === "unknown") return "unknown";
  if (row.status === "rate_limited") return "rate_limited"; // flagged but cooldown expired
  return row.status === "error" ? "error" : "online";
}
