import clsx from "clsx";
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  CheckCircle2,
  Coins,
  RefreshCw,
  ScrollText,
  X,
  XCircle,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";
import {
  ActivityCalendar,
  Badge,
  Button,
  CopyButton,
  EmptyState,
  ErrorNote,
  Loading,
} from "../components";
import {
  formatClock,
  formatCost,
  formatCount,
  formatDateTime,
  formatDuration,
  formatTokens,
  greeting,
  timeAgo,
} from "../format";
import { useT, type TFn, type TranslationKey } from "../i18n";
import { useApi, useCountUp } from "../hooks";
import type { LogEntry, Model, OverviewResponse, Stats } from "../types";

/* ------------------------------------------------------------------ */
/* Types & helpers                                                     */
/* ------------------------------------------------------------------ */

interface Activity {
  tone: "success" | "warning" | "danger";
  icon: ReactNode;
  text: string;
}

const toneClasses: Record<Activity["tone"], string> = {
  success: "text-emerald-600 dark:text-emerald-400",
  warning: "text-amber-600 dark:text-amber-400",
  danger: "text-red-600 dark:text-red-400",
};

const STATUS_LABEL_KEYS: Partial<Record<string, TranslationKey>> = {
  operational: "overview.statusOperational",
  no_providers: "common.noProviders",
};

function healthOf(
  model: Model,
  t: TFn,
): { total: number; healthy: number; label: string; className: string } {
  const total = model.provider_count ?? model.providers.length;
  const healthy =
    model.healthy_count ??
    model.providers.filter((provider) => provider.enabled === 1 && provider.status === "online")
      .length;

  if (total === 0) {
    return { total, healthy, label: t("common.noProviders"), className: "text-zinc-400" };
  }

  const ratio = healthy / total;
  const className =
    ratio >= 1
      ? "text-emerald-600 dark:text-emerald-400"
      : ratio >= 0.5
        ? "text-amber-600 dark:text-amber-400"
        : "text-red-600 dark:text-red-400";

  return { total, healthy, label: t("overview.healthyPercent", { n: Math.round(ratio * 100) }), className };
}

function activityOf(log: LogEntry, t: TFn): Activity {
  const failover = log.failover ?? [];

  if (failover.length > 0 && log.ok === 1) {
    const parts = [log.model];
    for (const step of failover) {
      parts.push(step.provider, String(step.status));
    }
    return {
      tone: "warning",
      icon: <AlertTriangle aria-hidden className="h-3.5 w-3.5" />,
      text: parts.join(" → "),
    };
  }

  if (log.ok === 1) {
    return {
      tone: "success",
      icon: <Check aria-hidden className="h-3.5 w-3.5" />,
      text: `${log.model} → ${log.provider_name ?? t("overview.unknown")} · ${formatDuration(log.duration_ms)}`,
    };
  }

  const target = log.provider_name ? ` → ${log.provider_name}` : "";
  const reason = log.error ?? (log.status !== null ? `HTTP ${log.status}` : t("error.requestFailed"));
  return {
    tone: "danger",
    icon: <X aria-hidden className="h-3.5 w-3.5" />,
    text: `${log.model}${target} · ${reason}`,
  };
}

/** Section heading with an optional right-aligned meta/action. */
function SectionHead({
  title,
  meta,
  action,
}: {
  title: string;
  meta?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-baseline gap-3">
        <h2 className="text-sm font-semibold tracking-tight text-ink">{title}</h2>
        {meta && <span className="text-xs text-ink-3">{meta}</span>}
      </div>
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Onboarding checklist (shown until the basics are set up)            */
/* ------------------------------------------------------------------ */

type OnboardingPage = "models" | "providers" | "settings";

interface OnboardingStep {
  done: boolean;
  title: string;
  hint: string;
  action: string;
  page: OnboardingPage;
}

function OnboardingCard({
  steps,
  onNavigate,
}: {
  steps: OnboardingStep[];
  onNavigate: (page: OnboardingPage) => void;
}) {
  const { t } = useT();
  const doneCount = steps.filter((step) => step.done).length;
  const percent = Math.round((doneCount / Math.max(1, steps.length)) * 100);

  return (
    <section className="anim-in overflow-hidden rounded-2xl border border-hairline bg-panel">
      <div className="px-5 pt-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink">{t("onboarding.title")}</h2>
          <span className="text-xs text-ink-3">
            {t("onboarding.progress", { done: doneCount, total: steps.length })}
          </span>
        </div>

        {/* Animated progress bar */}
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-panel-2">
          <div
            className="anim-bar-grow h-full rounded-full bg-accent transition-[width] duration-700 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      <ol className="space-y-1 px-3 py-3">
        {steps.map((step, index) => (
          <li
            key={step.page}
            className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-panel-2/70"
          >
            <span
              className={clsx(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                step.done
                  ? "bg-accent-soft text-accent"
                  : "bg-panel-2 text-ink-2 ring-1 ring-hairline",
              )}
            >
              {step.done ? <Check aria-hidden className="h-3.5 w-3.5" /> : index + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span
                className={clsx(
                  "block text-sm font-medium",
                  step.done ? "text-ink-3 line-through decoration-hairline" : "text-ink",
                )}
              >
                {step.title}
              </span>
              <span className="block text-xs text-ink-3">{step.hint}</span>
            </span>
            <Button
              size="sm"
              variant={step.done ? "ghost" : "secondary"}
              onClick={() => onNavigate(step.page)}
            >
              {step.action}
            </Button>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* KPI cards                                                           */
/* ------------------------------------------------------------------ */

type Range = "today" | "7d" | "30d";

const RANGES: { id: Range; labelKey: TranslationKey }[] = [
  { id: "today", labelKey: "overview.range.today" },
  { id: "7d", labelKey: "overview.range.7d" },
  { id: "30d", labelKey: "overview.range.30d" },
];

function StatCard({
  icon,
  label,
  value,
  hint,
  tone = "default",
  delay,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "success" | "danger";
  delay: number;
}) {
  const toneIcon = {
    default: "text-ink-3",
    success: "text-emerald-600 dark:text-emerald-400",
    danger: "text-red-600 dark:text-red-400",
  }[tone];

  return (
    <div
      className="anim-in group relative overflow-hidden rounded-xl border border-hairline bg-panel p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-[0_8px_24px_-16px_rgb(0_0_0/0.5)]"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs text-ink-2">{label}</span>
        <span className={clsx("transition-transform duration-200 group-hover:scale-110", toneIcon)}>
          {icon}
        </span>
      </div>
      <p className="mt-2 text-xl font-semibold tabular-nums tracking-tight text-ink">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-ink-3">{hint}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function OverviewPage({
  onNavigate,
}: {
  onNavigate: (page: "models" | "providers" | "settings" | "logs") => void;
}) {
  const { t } = useT();
  const { data, error, loading, reload } = useApi<OverviewResponse>("/admin/api/overview");

  const [range, setRange] = useState<Range>("today");
  const statsQuery = useApi<{ stats: Stats }>(`/admin/api/stats?range=${range}`);

  const operational = data?.status === "operational";
  const statusKey = data === null ? undefined : STATUS_LABEL_KEYS[data.status];
  const statusLabel =
    data === null ? "…" : statusKey !== undefined ? t(statusKey) : data.status.replace(/_/g, " ");

  const models = data?.models ?? [];
  const errors = data?.errors ?? [];
  const hasModel = models.length > 0;
  const hasProvider = models.some(
    (model) => (model.provider_count ?? model.providers.length) > 0,
  );
  const hasApiKey = data?.has_api_key ?? false;
  // Onboarding is only needed until the first model exists or a router key is issued.
  const showOnboarding = data !== null && (!hasModel || !hasApiKey);

  const onboardingSteps: OnboardingStep[] = [
    {
      done: hasModel,
      title: t("onboarding.createModel.title"),
      hint: t("onboarding.createModel.hint"),
      action: t("onboarding.createModel.action"),
      page: "models",
    },
    {
      done: hasProvider,
      title: t("onboarding.addProvider.title"),
      hint: t("onboarding.addProvider.hint"),
      action: t("onboarding.addProvider.action"),
      page: "providers",
    },
    {
      done: hasApiKey,
      title: t("onboarding.getApiKey.title"),
      hint: t("onboarding.getApiKey.hint"),
      action: t("onboarding.getApiKey.action"),
      page: "settings",
    },
  ];

  const stats = statsQuery.data?.stats ?? null;

  /* Animated KPI values */
  const requests = useCountUp(stats?.requests ?? 0);
  const successful = useCountUp(stats?.successful ?? 0);
  const failed = useCountUp(stats?.failed ?? 0);
  const tokensIn = useCountUp(stats?.tokens_in ?? 0);
  const tokensOut = useCountUp(stats?.tokens_out ?? 0);
  const cost = useCountUp(stats?.cost ?? 0);

  const successRate =
    stats && stats.requests > 0 ? Math.round((stats.successful / stats.requests) * 100) : null;

  const totalProviders = models.reduce(
    (sum, model) => sum + (model.provider_count ?? model.providers.length),
    0,
  );
  const healthyProviders = models.reduce((sum, model) => {
    const total = model.provider_count ?? model.providers.length;
    if (total === 0) return sum;
    return (
      sum +
      (model.healthy_count ??
        model.providers.filter(
          (provider) => provider.enabled === 1 && provider.status === "online",
        ).length)
    );
  }, 0);

  const endpoint = `${typeof window === "undefined" ? "" : window.location.origin}/v1`;
  const delay = (index: number): CSSProperties => ({ animationDelay: `${Math.min(index, 8) * 45}ms` });

  return (
    <div className="space-y-8">
      {/* ------------------------------------------------------------ */}
      {/* Hero                                                          */}
      {/* ------------------------------------------------------------ */}
      <section className="anim-in grain relative overflow-hidden rounded-2xl border border-hairline bg-panel">
        <div aria-hidden className="mesh-blob mesh-a -left-16 -top-24 h-64 w-64" />
        <div aria-hidden className="mesh-blob mesh-b -right-12 -top-20 h-64 w-64" />

        <div className="relative px-5 py-6 sm:px-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-ink-3">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-accent anim-pulse-ring" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
                </span>
                MixRoute · {t("overview.live")}
              </div>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">{greeting()}</h1>
              <p className="mt-1 text-sm text-ink-2">{t("overview.subtitle")}</p>
            </div>

            <div className="flex items-center gap-2">
              {data && (
                <Badge tone={operational ? "success" : "warning"}>
                  <span
                    className={clsx(
                      "h-1.5 w-1.5 rounded-full",
                      operational ? "bg-emerald-500" : "bg-amber-500",
                    )}
                  />
                  {statusLabel}
                </Badge>
              )}
              <Button
                variant="ghost"
                onClick={reload}
                aria-label={t("a11y.refreshOverview")}
                className="px-2"
              >
                <RefreshCw aria-hidden className={clsx("h-4 w-4", loading && "animate-spin")} />
              </Button>
            </div>
          </div>

          {/* Quick metrics + endpoint */}
          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-hairline-soft pt-4">
            <QuickMetric label={t("nav.models")} value={formatCount(models.length)} />
            <QuickMetric
              label={t("nav.providers")}
              value={
                totalProviders > 0
                  ? `${healthyProviders}/${totalProviders}`
                  : t("common.noProviders")
              }
              tone={totalProviders > 0 && healthyProviders === totalProviders ? "success" : "default"}
            />
            <div className="ml-auto flex items-center gap-2 rounded-lg border border-hairline bg-panel-2/70 px-3 py-1.5">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-accent">
                {t("overview.endpoint")}
              </span>
              <code className="max-w-[240px] truncate font-mono text-xs text-ink-2">{endpoint}</code>
              <CopyButton text={endpoint} label={t("overview.copyEndpoint")} size="sm" variant="ghost" />
            </div>
          </div>
        </div>
      </section>

      {data && showOnboarding && (
        <OnboardingCard steps={onboardingSteps} onNavigate={onNavigate} />
      )}

      {error && <ErrorNote message={error} onRetry={reload} />}
      {loading && !data && <Loading />}

      {data && (
        <>
          {/* ---------------------------------------------------------- */}
          {/* Stats (KPI + calendar + per-provider breakdown)            */}
          {/* ---------------------------------------------------------- */}
          <section className="anim-in mx-delay-1" style={{ animationDelay: "80ms" }}>
            <SectionHead
              title={t("overview.statsHeading")}
              meta={t("overview.statsDesc")}
              action={
                <div className="inline-flex rounded-lg border border-hairline bg-panel p-0.5">
                  {RANGES.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={range === item.id}
                      onClick={() => setRange(item.id)}
                      className={clsx(
                        "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                        range === item.id
                          ? "bg-panel-2 text-ink shadow-sm ring-1 ring-hairline"
                          : "text-ink-3 hover:text-ink",
                      )}
                    >
                      {t(item.labelKey)}
                    </button>
                  ))}
                </div>
              }
            />

            {statsQuery.error && (
              <ErrorNote message={statsQuery.error} onRetry={statsQuery.reload} />
            )}
            {statsQuery.loading && !stats && <Loading label={t("overview.statsLoading")} />}

            {stats && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  <StatCard
                    delay={0}
                    icon={<Activity aria-hidden className="h-4 w-4" />}
                    label={t("table.requests")}
                    value={formatCount(Math.round(requests))}
                  />
                  <StatCard
                    delay={60}
                    icon={<CheckCircle2 aria-hidden className="h-4 w-4" />}
                    label={t("overview.successRate")}
                    value={successRate === null ? "—" : `${successRate}%`}
                    hint={
                      successRate === null
                        ? undefined
                        : `${formatCount(Math.round(successful))} ${t("table.successful").toLowerCase()}`
                    }
                    tone="success"
                  />
                  <StatCard
                    delay={120}
                    icon={<XCircle aria-hidden className="h-4 w-4" />}
                    label={t("table.errors")}
                    value={formatCount(Math.round(failed))}
                    tone={stats.failed > 0 ? "danger" : "default"}
                  />
                  <StatCard
                    delay={180}
                    icon={<ArrowDownToLine aria-hidden className="h-4 w-4" />}
                    label={t("tokens.in")}
                    value={formatTokens(Math.round(tokensIn))}
                  />
                  <StatCard
                    delay={240}
                    icon={<ArrowUpFromLine aria-hidden className="h-4 w-4" />}
                    label={t("tokens.out")}
                    value={formatTokens(Math.round(tokensOut))}
                  />
                  <StatCard
                    delay={300}
                    icon={<Coins aria-hidden className="h-4 w-4" />}
                    label={t("table.cost")}
                    value={formatCost(cost)}
                  />
                </div>

                {/* GitHub-style contribution calendar (last 120 days). */}
                <ActivityCalendar />

                {stats.providers.length === 0 ? (
                  <EmptyState
                    title={t("overview.statsEmptyTitle")}
                    hint={t("overview.statsEmptyHint")}
                  />
                ) : (
                  <div className="overflow-hidden rounded-xl border border-hairline bg-panel">
                    <div className="border-b border-hairline-soft px-4 py-3">
                      <span className="text-xs font-semibold text-ink">
                        {t("overview.byProvider")}
                      </span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[720px] text-left text-sm">
                        <thead>
                          <tr className="border-b border-hairline text-xs font-medium text-ink-3">
                            <th className="px-4 py-2.5 font-medium">{t("common.provider")}</th>
                            <th className="px-4 py-2.5 text-right font-medium">
                              {t("table.requests")}
                            </th>
                            <th className="px-4 py-2.5 text-right font-medium">
                              {t("table.successful")}
                            </th>
                            <th className="px-4 py-2.5 text-right font-medium">
                              {t("table.errors")}
                            </th>
                            <th className="px-4 py-2.5 text-right font-medium">{t("tokens.in")}</th>
                            <th className="px-4 py-2.5 text-right font-medium">
                              {t("tokens.out")}
                            </th>
                            <th className="px-4 py-2.5 text-right font-medium">{t("table.cost")}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-hairline-soft">
                          {stats.providers.map((provider) => (
                            <tr
                              key={provider.provider_id}
                              className="transition-colors hover:bg-panel-2/60"
                            >
                              <td className="px-4 py-2.5 text-sm font-medium text-ink">
                                {provider.provider_name}
                              </td>
                              <td className="px-4 py-2.5 text-right text-sm tabular-nums text-ink-2">
                                {formatCount(provider.requests)}
                              </td>
                              <td className="px-4 py-2.5 text-right text-sm tabular-nums text-emerald-600 dark:text-emerald-400">
                                {formatCount(provider.successful)}
                              </td>
                              <td className="px-4 py-2.5 text-right text-sm tabular-nums text-red-600 dark:text-red-400">
                                {formatCount(provider.failed)}
                              </td>
                              <td className="px-4 py-2.5 text-right text-sm tabular-nums text-ink-2">
                                {formatTokens(provider.tokens_in)}
                              </td>
                              <td className="px-4 py-2.5 text-right text-sm tabular-nums text-ink-2">
                                {formatTokens(provider.tokens_out)}
                              </td>
                              <td className="px-4 py-2.5 text-right text-sm tabular-nums text-ink-2">
                                {formatCost(provider.cost)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* ---------------------------------------------------------- */}
          {/* Models & health                                             */}
          {/* ---------------------------------------------------------- */}
          <section className="anim-in mx-delay-2" style={{ animationDelay: "140ms" }}>
            <SectionHead
              title={t("overview.modelsHeading")}
              meta={t("overview.total", { n: data.models.length })}
              action={
                <Button size="sm" variant="ghost" onClick={() => onNavigate("models")}>
                  {t("nav.models")} →
                </Button>
              }
            />

            {data.models.length === 0 ? (
              <EmptyState title={t("empty.noModels")} hint={t("overview.emptyModelsHint")} />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {data.models.map((model, index) => {
                  const health = healthOf(model, t);
                  return (
                    <div
                      key={model.id}
                      className="anim-in group rounded-xl border border-hairline bg-panel p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/40"
                      style={delay(index)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-mono text-sm font-medium text-ink">
                            {model.name}
                          </p>
                          <p className="mt-0.5 text-xs text-ink-3">
                            {t("overview.providerCount", { n: health.total })}
                          </p>
                        </div>
                        <span
                          className={clsx(
                            "shrink-0 text-xs font-medium tabular-nums",
                            health.className,
                          )}
                        >
                          {health.label}
                        </span>
                      </div>

                      {/* Health bar */}
                      {health.total > 0 && (
                        <div className="mt-3 h-1 overflow-hidden rounded-full bg-panel-2">
                          <div
                            className="anim-bar-grow h-full rounded-full"
                            style={{
                              width: `${Math.round((health.healthy / health.total) * 100)}%`,
                              backgroundColor:
                                health.healthy === health.total
                                  ? "var(--mx-accent)"
                                  : health.healthy > 0
                                    ? "var(--mx-warn)"
                                    : "var(--mx-danger)",
                              animationDelay: `${Math.min(index, 8) * 60 + 150}ms`,
                            }}
                          />
                        </div>
                      )}

                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
                        {model.providers.length === 0 ? (
                          <span className="text-xs text-ink-3">
                            {t("overview.providersNotConfigured")}
                          </span>
                        ) : (
                          model.providers.map((provider) => (
                            <span
                              key={provider.id}
                              title={provider.status}
                              className="inline-flex items-center gap-1.5 text-xs text-ink-2"
                            >
                              <span
                                className={clsx(
                                  "h-1.5 w-1.5 shrink-0 rounded-full",
                                  provider.status === "online"
                                    ? "bg-emerald-500"
                                    : provider.status === "error"
                                      ? "bg-red-500"
                                      : provider.status === "disabled"
                                        ? "bg-zinc-400"
                                        : "bg-amber-500",
                                )}
                              />
                              <span className="truncate">{provider.name}</span>
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ---------------------------------------------------------- */}
          {/* Activity feed + errors                                      */}
          {/* ---------------------------------------------------------- */}
          <div className="grid gap-8 lg:grid-cols-2">
            <section className="anim-in mx-delay-3" style={{ animationDelay: "200ms" }}>
              <SectionHead
                title={t("overview.recentHeading")}
                meta={t("overview.recentCount", { n: data.recent.length })}
                action={
                  <Button size="sm" variant="ghost" onClick={() => onNavigate("logs")}>
                    <ScrollText aria-hidden className="h-3.5 w-3.5" />
                    {t("overview.openLogs")}
                  </Button>
                }
              />

              {data.recent.length === 0 ? (
                <EmptyState
                  title={t("overview.emptyRecentTitle")}
                  hint={t("overview.emptyRecentHint")}
                />
              ) : (
                <div className="divide-y divide-hairline-soft overflow-hidden rounded-xl border border-hairline bg-panel">
                  {data.recent.map((log, index) => {
                    const activity = activityOf(log, t);
                    return (
                      <div
                        key={log.request_id}
                        className="anim-fade flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-panel-2/60"
                        style={delay(index)}
                      >
                        <span
                          className={clsx(
                            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-panel-2",
                            toneClasses[activity.tone],
                          )}
                        >
                          {activity.icon}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-ink-2">
                          {activity.text}
                        </span>
                        <span
                          className="shrink-0 text-xs tabular-nums text-ink-3"
                          title={formatDateTime(log.created_at)}
                        >
                          {timeAgo(log.created_at)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {errors.length > 0 && (
              <section className="anim-in mx-delay-4" style={{ animationDelay: "260ms" }}>
                <SectionHead
                  title={t("overview.errorsHeading")}
                  meta={t("overview.recentCount", { n: errors.length })}
                />

                <div className="divide-y divide-hairline-soft overflow-hidden rounded-xl border border-hairline bg-panel">
                  {errors.map((log, index) => (
                    <div
                      key={log.request_id}
                      className="anim-fade flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-panel-2/60"
                      style={delay(index)}
                    >
                      <span
                        className="w-14 shrink-0 text-xs tabular-nums text-ink-3"
                        title={formatDateTime(log.created_at)}
                      >
                        {formatClock(log.created_at)}
                      </span>
                      <span
                        className="w-36 shrink-0 truncate font-mono text-xs text-ink-2"
                        title={log.model}
                      >
                        {log.model}
                      </span>
                      <span
                        className="hidden w-32 shrink-0 truncate text-xs text-ink-3 sm:block"
                        title={log.provider_name ?? undefined}
                      >
                        {log.provider_name ?? "—"}
                      </span>
                      <span className="shrink-0 text-xs font-medium tabular-nums text-red-600 dark:text-red-400">
                        {log.status ?? "—"}
                      </span>
                      <span
                        className="min-w-0 flex-1 truncate text-xs text-ink-3"
                        title={log.error ?? undefined}
                      >
                        {log.error ?? t("error.requestFailed")}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Small pieces                                                        */
/* ------------------------------------------------------------------ */

function QuickMetric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "success";
}) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-ink-3">{label}</p>
      <p
        className={clsx(
          "mt-0.5 text-lg font-semibold tabular-nums tracking-tight",
          tone === "success" ? "text-accent" : "text-ink",
        )}
      >
        {value}
      </p>
    </div>
  );
}
