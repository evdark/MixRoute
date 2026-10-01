import clsx from "clsx";
import type { ReactNode } from "react";
import { t, useT, type TranslationKey } from "../i18n";
import type { ProviderStatus } from "../types";

export type BadgeTone = "default" | "success" | "warning" | "danger" | "info";

const toneClasses: Record<BadgeTone, string> = {
  default: "border-hairline bg-panel-2 text-ink-2",
  success: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  warning: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  danger: "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-400",
  info: "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-400",
};

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}

export function Badge({ tone = "default", children, className }: BadgeProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4",
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export interface StatusMeta {
  label: string;
  tone: BadgeTone;
  dot: string;
}

interface StatusSpec {
  labelKey: TranslationKey;
  tone: BadgeTone;
  dot: string;
}

export const STATUS_META: Partial<Record<ProviderStatus, StatusSpec>> = {
  online: { labelKey: "status.online", tone: "success", dot: "bg-emerald-500" },
  rate_limited: { labelKey: "status.rateLimited", tone: "warning", dot: "bg-amber-500" },
  cooling: { labelKey: "status.cooling", tone: "warning", dot: "bg-amber-400" },
  error: { labelKey: "status.error", tone: "danger", dot: "bg-red-500" },
  disabled: { labelKey: "status.disabled", tone: "default", dot: "bg-zinc-400" },
  unknown: { labelKey: "status.unknown", tone: "default", dot: "bg-zinc-400" },
};

const UNKNOWN_STATUS: StatusSpec = {
  labelKey: "status.unknown",
  tone: "default",
  dot: "bg-zinc-400",
};

/** Tolerates unexpected status strings from the API. Label is translated now. */
export function statusMeta(status: ProviderStatus): StatusMeta {
  const spec = STATUS_META[status] ?? UNKNOWN_STATUS;
  return { label: t(spec.labelKey), tone: spec.tone, dot: spec.dot };
}

export interface StatusBadgeProps {
  status: ProviderStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  useT(); // re-render when the language changes
  const meta = statusMeta(status);
  return (
    <Badge tone={meta.tone} className={className}>
      <span className={clsx("h-1.5 w-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </Badge>
  );
}
