import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { Button, type ButtonSize, type ButtonVariant } from "./Button";

export interface CopyButtonProps {
  text: string;
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}

/** Copies `text` and briefly swaps its label for a checkmark. */
export function CopyButton({
  text,
  label,
  variant = "secondary",
  size = "sm",
  className,
}: CopyButtonProps) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    setCopied(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Button variant={variant} size={size} className={className} onClick={copy}>
      {copied ? <Check aria-hidden className="h-3.5 w-3.5" /> : <Copy aria-hidden className="h-3.5 w-3.5" />}
      {copied ? t("common.copied") : (label ?? t("common.copy"))}
    </Button>
  );
}
