import { useEffect, useRef, useState } from "react";
import {
  deleteAdminQdrantPoint,
  getAdminProviderItems,
} from "../../api/client";
import type { QdrantItem } from "../../types";
import type { ControllerOptions, PendingDeletion } from "./admin.types";
import { useRequestScope } from "./useRequestScope";
export function useProviderItems({
  enabled,
  onError,
  onDeleted,
}: ControllerOptions & { onDeleted(provider: string, deleted: number): void }) {
  const [itemsByProvider, setItems] = useState<
    Readonly<Record<string, readonly QdrantItem[] | null>>
  >({});
  const [openProvider, setOpen] = useState<string | null>(null);
  const [loadingProviders, setLoading] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [pendingDeletion, setPending] = useState<PendingDeletion | null>(null);
  const [deletingProviders, setDeleting] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [error, setError] = useState<string | null>(null);
  const deleting = useRef(false);
  const scope = useRequestScope(enabled);
  useEffect(() => {
    if (!enabled) {
      setError(null);
      setItems({});
      setOpen(null);
      setPending(null);
      setLoading(new Set());
      setDeleting(new Set());
      deleting.current = false;
    }
  }, [enabled]);
  async function open(provider: string) {
    if (!enabled) return;
    const id = scope.capture();
    setOpen(provider);
    setLoading((s) => new Set(s).add(provider));
    try {
      const r = await getAdminProviderItems(provider);
      if (scope.current(id)) setItems((s) => ({ ...s, [provider]: r.items }));
    } catch (e) {
      if (scope.current(id)) {
        setOpen(null);
        onError(e, "Could not load embedded items");
      }
    } finally {
      if (scope.current(id))
        setLoading((s) => new Set([...s].filter((p) => p !== provider)));
    }
  }
  async function confirmDelete() {
    if (!enabled || !pendingDeletion || deleting.current) return;
    deleting.current = true;
    setError(null);
    const id = scope.capture();
    const { providerId, item } = pendingDeletion;
    setDeleting((s) => new Set(s).add(providerId));
    try {
      const response = await deleteAdminQdrantPoint(item.point_id);
      if (scope.current(id)) {
        setItems((s) => ({
          ...s,
          [providerId]: (s[providerId] ?? []).filter(
            (i) => i.point_id !== item.point_id,
          ),
        }));
        setPending(null);
        onDeleted(providerId, response.deleted);
      }
    } catch (e) {
      if (scope.current(id)) {
        setError("Could not delete embedded item");
        onError(e, "Could not delete embedded item");
      }
    } finally {
      if (scope.current(id)) {
        deleting.current = false;
        setDeleting((s) => new Set([...s].filter((p) => p !== providerId)));
      }
    }
  }
  return {
    error,
    itemsByProvider,
    openProvider,
    loadingProviders,
    pendingDeletion,
    deletingProviders,
    open,
    close: () => {
      if (!deleting.current) {
        setOpen(null);
        setPending(null);
      }
    },
    requestDelete: (providerId: string, item: QdrantItem) => {
      setError(null);
      setPending({ providerId, item });
    },
    cancelDelete: () => {
      if (!deleting.current) setPending(null);
    },
    confirmDelete,
  };
}
