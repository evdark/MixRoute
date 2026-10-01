import clsx from "clsx";
import type { ReactNode } from "react";

export interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Label + control (+ optional hint) stacked with consistent spacing. */
export function Field({ label, hint, children, className }: FieldProps) {
  return (
    <label className={clsx("block", className)}>
      {label !== undefined && (
        <span className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
          {label}
        </span>
      )}
      {children}
      {hint !== undefined && (
        <span className="mt-1.5 block text-xs text-zinc-500">{hint}</span>
      )}
    </label>
  );
}
