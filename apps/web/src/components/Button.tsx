import clsx from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and disables the button while the action runs. */
  pending?: boolean;
  icon?: ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-ink text-bg hover:opacity-90 dark:bg-accent dark:text-black dark:hover:bg-emerald-400",
  secondary:
    "border border-hairline bg-panel-2 text-ink-2 hover:text-ink hover:border-accent/30",
  ghost: "text-ink-2 hover:bg-panel-2 hover:text-ink",
  danger:
    "border border-red-500/30 bg-panel-2 text-red-600 hover:bg-red-500/10 dark:text-red-400",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 px-2.5 text-xs",
  md: "h-9 gap-2 px-3.5 text-sm",
};

const baseClasses =
  "inline-flex select-none items-center justify-center whitespace-nowrap rounded-lg font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/40";

export function Button({
  variant = "secondary",
  size = "md",
  pending = false,
  icon,
  type = "button",
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={clsx(baseClasses, variantClasses[variant], sizeClasses[size], className)}
      disabled={disabled || pending}
      {...rest}
    >
      {pending ? <Spinner className="h-3.5 w-3.5" /> : icon}
      {children}
    </button>
  );
}
