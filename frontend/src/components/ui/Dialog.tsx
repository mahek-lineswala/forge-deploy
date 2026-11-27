import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "./Button";
import { Input } from "./Fields";
import { ErrorBox } from "./Layout";

/**
 * Modal confirmation built on the native <dialog>: focus trapping, Escape and
 * the backdrop come from the browser. Set `confirmText` to require typing a name
 * before a destructive action can proceed.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  confirmText,
  danger = true,
  pending,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  confirmText?: string;
  danger?: boolean;
  pending?: boolean;
  error?: unknown;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      setTyped("");
      dialog.showModal();
    }

    if (!open && dialog.open) dialog.close();
  }, [open]);

  const allowed = !confirmText || typed === confirmText;

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current && !pending) onClose();
      }}
      className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-2xl border border-line-strong bg-surface p-0 text-fg shadow-2xl"
    >
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (allowed && !pending) onConfirm();
        }}
        className="space-y-4 p-6"
      >
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          {description && <div className="mt-1.5 text-sm text-muted">{description}</div>}
        </div>

        {confirmText && (
          <label className="block space-y-1.5 text-sm">
            <span className="text-muted">
              Type <span className="font-mono text-fg">{confirmText}</span> to confirm
            </span>
            <Input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} className="font-mono" />
          </label>
        )}

        <ErrorBox error={error} />

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" variant={danger ? "danger" : "primary"} loading={pending} disabled={!allowed}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
