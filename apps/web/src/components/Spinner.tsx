import clsx from "clsx";
import { useT } from "../i18n";

export interface SpinnerProps {
  className?: string;
}

/** Dependency-free CSS spinner. Inherits `currentColor`. */
export function Spinner({ className }: SpinnerProps) {
  const { t } = useT();
  return (
    <span
      role="status"
      aria-label={t("a11y.loading")}
      className={clsx(
        "inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent",
        className,
      )}
    />
  );
}
