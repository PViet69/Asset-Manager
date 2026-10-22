import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";
import styles from "./ModelUnavailableDialog.module.css";

export type ModelUnavailableDialogProps = { readonly onDismiss: () => void };

export function ModelUnavailableDialog({
  onDismiss,
}: ModelUnavailableDialogProps): JSX.Element {
  return (
    <Dialog
      isOpen
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
      title="Service Unavailable"
      role="alertdialog"
    >
      <p className={styles.message}>Model not found</p>
      <div className={styles.actions}>
        <Button
          variant="primary"
          aria-label="Dismiss search error"
          onPress={onDismiss}
        >
          Dismiss
        </Button>
      </div>
    </Dialog>
  );
}
