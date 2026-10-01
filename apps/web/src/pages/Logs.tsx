import clsx from "clsx";
import { ArrowRight, ChevronDown, RefreshCw, Search } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Badge, Button, EmptyState, ErrorNote, Loading } from "../components";
import {
  formatClock,
  formatCost,
  formatDateTime,
  formatDuration,
  formatTokens,
  timeAgo,
} from "../format";
import { useT } from "../i18n";
import type { LogEntry } from "../types";

const PAGE_SIZE = 100;

function statusClasses(status: number | null): string {
  if (status === null) return "text-zinc-400";
  if (status >= 200 && status < 300) return "text-emerald-600 dark:text-emerald-400";
  return "text-red-600 dark:text-red-400";
}

const gridClasses =
  "grid w-full grid-cols-[64px_1fr_48px_64px] items-center gap-3 px-4 text-left sm:grid-cols-[76px_1.3fr_1fr_56px_74px_100px_74px]";

export default function LogsPage() {
  const { t } = useT();
  const searchRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Debounce the search box.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  // "/" focuses the search input.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const active = document.activeElement;
      if (active instanceof HTMLElement) {
        const tag = active.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || active.isContentEditable) {
          return;
        }
      }
      event.preventDefault();
      searchRef.current?.focus();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // First page (also re-runs when the query changes or a refresh happens).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setExpanded(null);

    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: "0",
      q: debouncedQuery,
    });

    api<{ logs: LogEntry[] }>(`/admin/api/logs?${params.toString()}`)
      .then((result) => {
        if (cancelled) return;
        setLogs(result.logs);
        setExhausted(result.logs.length < PAGE_SIZE);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof Error && err.message !== "Unauthorized") setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, refreshKey]);

  async function loadMore() {
    setLoadingMore(true);
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(logs.length),
      q: debouncedQuery,
    });
    try {
      const result = await api<{ logs: LogEntry[] }>(`/admin/api/logs?${params.toString()}`);
      setLogs((previous) => [...previous, ...result.logs]);
      if (result.logs.length < PAGE_SIZE) setExhausted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("logs.loadMoreFailed"));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {t("nav.logs")}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">{t("logs.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="relative block">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
            />
            <input
              ref={searchRef}
              type="search"
              aria-label={t("logs.search")}
              placeholder={t("logs.search")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-9 w-full rounded-lg border border-zinc-200 bg-white pl-8 pr-9 text-sm text-zinc-900 placeholder:text-zinc-400 transition-colors focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-500/20 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500 sm:w-64"
            />
            <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-500 sm:block">
              /
            </kbd>
          </span>
          <Button
            variant="ghost"
            onClick={() => setRefreshKey((value) => value + 1)}
            aria-label={t("a11y.refreshLogs")}
            className="px-2"
          >
            <RefreshCw aria-hidden className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {error && <ErrorNote message={error} onRetry={() => setRefreshKey((v) => v + 1)} />}
      {loading && logs.length === 0 && <Loading label={t("logs.loading")} />}

      {!loading && logs.length === 0 && (
        <EmptyState
          title={debouncedQuery ? t("logs.emptySearch.title") : t("logs.empty.title")}
          hint={debouncedQuery ? t("logs.emptySearch.hint") : t("logs.empty.hint")}
        />
      )}

      {logs.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div
            className={clsx(
              gridClasses,
              "border-b border-zinc-200 py-2.5 text-xs font-medium text-zinc-500 dark:border-zinc-800",
            )}
          >
            <span>{t("table.time")}</span>
            <span>{t("common.model")}</span>
            <span className="hidden sm:block">{t("common.provider")}</span>
            <span>{t("table.status")}</span>
            <span className="hidden sm:block">{t("table.latency")}</span>
            <span className="hidden sm:block">{t("table.tokensInOut")}</span>
            <span className="text-right">{t("table.cost")}</span>
          </div>

          {logs.map((log) => {
            const isExpanded = expanded === log.request_id;
            const failover = log.failover ?? [];
            return (
              <div
                key={log.request_id}
                className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/70"
              >
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  onClick={() => setExpanded(isExpanded ? null : log.request_id)}
                  className={clsx(
                    gridClasses,
                    "py-2.5 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/40",
                  )}
                >
                  <span
                    className="text-xs tabular-nums text-zinc-500"
                    title={formatDateTime(log.created_at)}
                  >
                    {formatClock(log.created_at)}
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <ChevronDown
                      aria-hidden
                      className={clsx(
                        "h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform",
                        isExpanded && "rotate-180",
                      )}
                    />
                    <span className="truncate text-sm text-zinc-800 dark:text-zinc-200">
                      {log.model}
                    </span>
                  </span>
                  <span className="hidden truncate text-sm text-zinc-600 dark:text-zinc-400 sm:block">
                    {log.provider_name ?? "—"}
                  </span>
                  <span className={clsx("text-xs font-medium tabular-nums", statusClasses(log.status))}>
                    {log.status ?? "—"}
                  </span>
                  <span className="hidden text-xs tabular-nums text-zinc-500 sm:block">
                    {formatDuration(log.duration_ms)}
                  </span>
                  <span className="hidden gap-1 text-xs tabular-nums text-zinc-500 sm:flex">
                    <span title={t("tokens.in")}>{formatTokens(log.tokens_in)}</span>
                    <span className="text-zinc-300 dark:text-zinc-600">/</span>
                    <span title={t("tokens.out")}>{formatTokens(log.tokens_out)}</span>
                  </span>
                  <span className="text-right text-xs tabular-nums text-zinc-500">
                    {formatCost(log.cost)}
                  </span>
                </button>

                {isExpanded && (
                  <div className="space-y-2.5 border-t border-zinc-100 bg-zinc-50/60 px-4 py-3.5 text-xs dark:border-zinc-800/70 dark:bg-zinc-950/40">
                    <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-zinc-500">
                      <span>
                        {t("logs.request")}{" "}
                        <code className="font-mono text-zinc-700 dark:text-zinc-300">
                          {log.request_id}
                        </code>
                      </span>
                      <span title={timeAgo(log.created_at)}>{formatDateTime(log.created_at)}</span>
                      <span>
                        {log.streaming === 1 ? t("logs.streaming") : t("logs.nonStreaming")}
                      </span>
                      <span title={t("logs.duration")}>{formatDuration(log.duration_ms)}</span>
                    </div>

                    {failover.length > 0 && (
                      <div>
                        <p className="mb-1.5 font-medium text-zinc-600 dark:text-zinc-400">
                          {t("logs.failoverChain")}
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {failover.map((step, index) => (
                            <Fragment key={`${step.provider}-${index}`}>
                              {index > 0 && (
                                <ArrowRight aria-hidden className="h-3 w-3 text-zinc-400" />
                              )}
                              <Badge tone="warning">
                                {step.provider} · {step.status}
                              </Badge>
                            </Fragment>
                          ))}
                          <ArrowRight aria-hidden className="h-3 w-3 text-zinc-400" />
                          <Badge tone={log.ok === 1 ? "success" : "danger"}>
                            {log.provider_name ?? "—"} · {log.status ?? "—"}
                          </Badge>
                        </div>
                      </div>
                    )}

                    {log.error && (
                      <div>
                        <p className="mb-1.5 font-medium text-zinc-600 dark:text-zinc-400">
                          {t("logs.errorHeading")}
                        </p>
                        <p className="break-words rounded-md border border-red-200 bg-red-50 px-3 py-2 font-mono text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
                          {log.error}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {logs.length > 0 && !exhausted && (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={loadMore} pending={loadingMore}>
            {t("logs.loadMore")}
          </Button>
        </div>
      )}
    </div>
  );
}
