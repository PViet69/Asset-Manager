import type { ProviderDashboardStatus } from "../../types";
import { Dialog } from "../../components/ui/Dialog";
import { Button } from "../../components/ui/Button";
import type { useProviderItems } from "./useProviderItems";
import styles from "./ProviderItemsDialog.module.css";
export function ProviderItemsDialog({
  model,
  providers,
}: {
  model: ReturnType<typeof useProviderItems>;
  providers: readonly ProviderDashboardStatus[];
}): JSX.Element {
  const provider = providers.find((p) => p.provider === model.openProvider);
  const pending = model.pendingDeletion;
  const deleting = !!pending && model.deletingProviders.has(pending.providerId);
  const name = pending?.item.filename || pending?.item.point_id;
  return (
    <>
      <Dialog
        isOpen={!!model.openProvider}
        title={`${provider?.display_name ?? model.openProvider ?? "Provider"} embedded items`}
        onOpenChange={(open) => {
          if (!open) model.close();
        }}
      >
        <div className={styles.content}>
          {model.openProvider &&
          model.loadingProviders.has(model.openProvider) ? (
            <p role="status">Loading embedded items…</p>
          ) : (
            <ul className={styles.list}>
              {(model.itemsByProvider[model.openProvider ?? ""] ?? []).map(
                (item) => (
                  <li key={item.point_id}>
                    <span>{item.filename || item.point_id}</span>
                    <Button
                      variant="danger"
                      aria-label={`Delete ${item.filename || item.point_id}`}
                      isDisabled={model.deletingProviders.has(
                        model.openProvider ?? "",
                      )}
                      onPress={() =>
                        model.requestDelete(model.openProvider!, item)
                      }
                    >
                      Delete
                    </Button>
                  </li>
                ),
              )}
            </ul>
          )}
          {model.openProvider &&
            !model.loadingProviders.has(model.openProvider) &&
            model.itemsByProvider[model.openProvider]?.length === 0 && (
              <p>No embedded items.</p>
            )}
        </div>
        <Button onPress={model.close}>Close embedded items</Button>
        <Dialog
          isOpen={!!pending}
          title={`Remove ${name}?`}
          role="alertdialog"
          isDismissable={!deleting}
          isKeyboardDismissDisabled={deleting}
          onOpenChange={(open) => {
            if (!open) model.cancelDelete();
          }}
        >
          <p>
            This removes this source from vector search. This action cannot be
            undone.
          </p>
          {model.error && <p role="alert">{model.error}</p>}
          <div className={styles.actions}>
            <Button onPress={model.cancelDelete} isDisabled={deleting}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onPress={() => void model.confirmDelete()}
              isDisabled={deleting}
            >
              {deleting ? "Removing" : "Remove source"}
            </Button>
          </div>
        </Dialog>
      </Dialog>
    </>
  );
}
