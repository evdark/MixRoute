import { useT } from "../i18n";
import { Button } from "./Button";
import { Modal } from "./Modal";

export interface ConfirmProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  pending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/** Destructive-action confirmation dialog. */
export function Confirm({
  open,
  title,
  message,
  confirmLabel,
  pending = false,
  onConfirm,
  onClose,
}: ConfirmProps) {
  const { t } = useT();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" onClick={onConfirm} pending={pending}>
            {confirmLabel ?? t("common.delete")}
          </Button>
        </div>
      }
    >
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{message}</p>
    </Modal>
  );
}
