import type { Db } from "./db.js";
import { getNumericSetting } from "./db.js";
import { getHealth, recordHealthPing } from "./health.js";
import { getAdapter } from "./adapters/registry.js";
import { resolveProvider, type ProviderRow } from "./router.js";
import type { ProviderStatus } from "./status.js";

const PING_TIMEOUT_MS = 10_000;

/**
 * Map a raw adapter test error ("HTTP 429: ...", "connection refused", ...)
 * onto a status + cooldown, using the same classification as real traffic.
 */
function classifyPingError(db: Db, error: string): { status: ProviderStatus; cooldownMs: number } {
  const cooldown429 = getNumericSetting(db, "cooldown_429_ms");
  const cooldown5xx = getNumericSetting(db, "cooldown_5xx_ms");
  const cooldownTimeout = getNumericSetting(db, "cooldown_timeout_ms");
  const cooldownAuth = getNumericSetting(db, "cooldown_auth_ms");

  const http = /HTTP (\d{3})/.exec(error);
  if (http) {
    const s = Number(http[1]);
    if (s === 429) return { status: "rate_limited", cooldownMs: cooldown429 };
    if (s === 401 || s === 403) return { status: "error", cooldownMs: cooldownAuth };
    if (s >= 500) return { status: "error", cooldownMs: cooldown5xx };
    return { status: "error", cooldownMs: 0 };
  }
  if (/timeout|timed out/i.test(error)) return { status: "error", cooldownMs: cooldownTimeout };
  return { status: "error", cooldownMs: cooldownTimeout };
}

async function pingProvider(db: Db, row: ProviderRow): Promise<void> {
  if (!String(row.api_key_enc ?? "").trim()) {
    // never ping a provider with no key at all — it can only answer 401
    recordHealthPing(db, row.id, { ok: false, status: "error", error: "No API key configured", cooldownMs: 0 });
    return;
  }
  let provider;
  try {
    provider = resolveProvider(row);
  } catch {
    recordHealthPing(db, row.id, { ok: false, status: "error", error: "Unable to decrypt API key", cooldownMs: 0 });
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
  try {
    const result = await getAdapter(row.type).test(provider, controller.signal);
    if (result.ok) {
      recordHealthPing(db, row.id, { ok: true, status: "online" });
    } else {
      const cls = classifyPingError(db, result.error ?? "health check failed");
      recordHealthPing(db, row.id, { ok: false, ...cls, error: result.error ?? "health check failed" });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const cls = classifyPingError(db, message);
    recordHealthPing(db, row.id, { ok: false, ...cls, error: message });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ping every enabled provider whose health row is stale (no traffic and no
 * ping for `health_check_interval_ms`). Counters are NOT touched — these are
 * not routed requests. Returns the number of providers pinged.
 */
export async function runHealthChecks(db: Db): Promise<number> {
  const interval = getNumericSetting(db, "health_check_interval_ms");
  if (interval <= 0) return 0;

  const now = Date.now();
  const rows = db
    .prepare("SELECT * FROM providers WHERE enabled = 1 ORDER BY id")
    .all() as ProviderRow[];
  const due = rows.filter((row) => {
    const h = getHealth(db, row.id);
    return h.last_checked_at == null || now - h.last_checked_at >= interval;
  });
  if (!due.length) return 0;

  await Promise.all(due.map((row) => pingProvider(db, row)));
  return due.length;
}

let bootTimer: NodeJS.Timeout | null = null;
let loopTimer: NodeJS.Timeout | null = null;

/** Start the background loop (call once from index.ts). Safe to call twice. */
export function startHealthChecker(db: Db, log?: { info: (msg: string) => void }): void {
  if (bootTimer || loopTimer) return;
  const tick = () => {
    runHealthChecks(db)
      .then((n) => {
        if (n && log) log.info(`health-check: pinged ${n} provider${n === 1 ? "" : "s"}`);
      })
      .catch((err) => log?.info(`health-check failed: ${err instanceof Error ? err.message : String(err)}`));
  };
  // first pass shortly after boot, then at the configured interval
  bootTimer = setTimeout(tick, 3_000);
  loopTimer = setInterval(
    tick,
    Math.max(5_000, getNumericSetting(db, "health_check_interval_ms"))
  );
  bootTimer.unref();
  loopTimer.unref();
}

export function stopHealthChecker(): void {
  if (bootTimer) clearTimeout(bootTimer);
  if (loopTimer) clearInterval(loopTimer);
  bootTimer = null;
  loopTimer = null;
}
