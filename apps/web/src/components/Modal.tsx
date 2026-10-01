import clsx from "clsx";
import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { useT } from "../i18n";

export type ModalWidth = "sm" | "md" | "lg";

const widthClasses: Record<ModalWidth, string> = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
};

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: ModalWidth;
}

/** Fixed overlay + centered card, closes on Escape or backdrop click. */
export function Modal({ open, onClose, title, children, footer, width = "md" }: ModalProps) {
  const { t } = useT();
  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto p-4 sm:flex sm:items-center sm:justify-center sm:p-6">
      <div
        aria-hidden
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        onMouseDown={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={clsx(
          "anim-pop relative mx-auto w-full rounded-xl border border-hairline bg-panel shadow-2xl sm:my-auto",
          widthClasses[width],
        )}
      >
        <div className="flex items-center justify-between border-b border-hairline-soft px-5 py-3.5">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <button
            type="button"
            aria-label={t("common.close")}
            onClick={onClose}
            className="-mr-1 rounded-md p-1 text-ink-3 transition-colors hover:bg-panel-2 hover:text-ink"
          >
            <X aria-hidden className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4">{children}</div>

        {footer !== undefined && (
          <div className="border-t border-hairline-soft px-5 py-3.5">{footer}</div>
        )}
      </div>
    </div>
  );
}
