import clsx from "clsx";
import type { InputHTMLAttributes } from "react";

export const inputClasses =
  "h-9 w-full rounded-lg border border-hairline bg-panel-2 px-3 text-sm text-ink placeholder:text-ink-3 transition-colors focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-50";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

export function Input({ className, ...rest }: InputProps) {
  return <input className={clsx(inputClasses, className)} {...rest} />;
}
