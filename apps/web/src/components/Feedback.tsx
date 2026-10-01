import clsx from "clsx";
import type { ReactNode } from "react";
import { useT } from "../i18n";
import { Button } from "./Button";
import { Spinner } from "./Spinner";

export interface EmptyStateProps {
  title: string;
  hint?: string;
  icon?: ReactNode;
  className?: string;
}

/** Friendly one-liner shown when a list has nothing to display. */
export function EmptyState({ title, hint, icon, className }: EmptyStateProps) {
  return (
    <div
      className={clsx(
        "anim-fade rounded-xl border border-dashed border-hairline px-6 py-10 text-center",
        className,
      )}
    >
      {icon && <div className="mb-2 flex justify-center text-ink-3">{icon}</div>}
      <p className="text-sm font-medium text-ink-2">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-md text-xs text-ink-3">{hint}</p>}
    </div>
  );
}

export interface ErrorNoteProps {
  message: string;
  onRetry?: () => void;
  className?: string;
}

/** Inline error banner with an optional retry action. */
export function ErrorNote({ message, onRetry, className }: ErrorNoteProps) {
  const { t } = useT();
  return (
    <div
      className={clsx(
        "anim-fade flex items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-400",
        className,
      )}
    >
      <span className="min-w-0 truncate">{message}</span>
      {onRetry && (
        <Button size="sm" variant="danger" onClick={onRetry}>
          {t("common.retry")}
        </Button>
      )}
    </div>
  );
}

export function Loading({ label }: { label?: string }) {
  const { t } = useT();
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-3">
      <Spinner className="h-4 w-4" />
      {label ?? t("common.loading")}
    </div>
  );
}
