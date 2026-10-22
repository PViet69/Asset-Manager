import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  getAdminSyncStatus,
  refreshAdminProvider,
} from "../../api/client";
import type { ProviderDashboardStatus } from "../../types";
import {
  EMPTY_DASHBOARD,
  type DashboardState,
  type Toast,
} from "./admin.types";
import { useRequestScope } from "./useRequestScope";

export function useAdminDashboard({
  enabled,
  onUnauthorized,
}: {
  enabled: boolean;
  onUnauthorized(): void;
}) {
  const [dashboard, setDashboard] = useState<DashboardState>(EMPTY_DASHBOARD);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshingProviders, setRefreshing] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [toasts, setToasts] = useState<readonly Toast[]>([]);
  const scope = useRequestScope(enabled);
  const callbacks = useRef(onUnauthorized);
  callbacks.current = onUnauthorized;
  const sequence = useRef(0);
  const latestReload = useRef(0);
  const latestModelRequest = useRef(0);
  const providerRequests = useRef(new Map<string, number>());
  const refreshing = useRef(new Set<string>());

  const notify = useCallback((message: string, type: Toast["type"]) => {
    setToasts((current) => [
      ...current.slice(-4),
      { id: crypto.randomUUID(), message, type },
    ]);
  }, []);
  function fail(caught: unknown, fallback: string) {
    if (caught instanceof ApiError && caught.status === 401)
      callbacks.current();
    else {
      const message = caught instanceof ApiError ? caught.message : fallback;
      setError(message);
      notify(message, "error");
    }
  }
  async function reload() {
    if (!enabled) return;
    const generation = scope.capture();
    const ticket = ++sequence.current;
    latestReload.current = ticket;
    latestModelRequest.current = ticket;
    setLoading(true);
    try {
      const response = await getAdminSyncStatus();
      if (!scope.current(generation) || latestReload.current !== ticket) return;
      setDashboard((current) => {
        // A full response may overlap newer refreshes for individual providers.
        const providers = response.providers.map((provider) =>
          (providerRequests.current.get(provider.provider) ?? 0) > ticket
            ? (current.providers.find(
                (item) => item.provider === provider.provider,
              ) ?? provider)
            : provider,
        );
        for (const provider of current.providers) {
          if (
            (providerRequests.current.get(provider.provider) ?? 0) > ticket &&
            !providers.some((item) => item.provider === provider.provider)
          )
            providers.push(provider);
        }
        return {
          providers,
          embeddingModel:
            latestModelRequest.current === ticket
              ? response.embedding_model
              : current.embeddingModel,
          descriptionModel:
            latestModelRequest.current === ticket
              ? response.description_model
              : current.descriptionModel,
        };
      });
    } catch (caught) {
      if (scope.current(generation) && latestReload.current === ticket)
        fail(caught, "Could not load status");
    } finally {
      if (scope.current(generation) && latestReload.current === ticket)
        setLoading(false);
    }
  }
  async function refreshProvider(provider: string) {
    if (!enabled || refreshing.current.has(provider)) return;
    const generation = scope.capture();
    const ticket = ++sequence.current;
    providerRequests.current.set(provider, ticket);
    latestModelRequest.current = ticket;
    refreshing.current.add(provider);
    setRefreshing(new Set(refreshing.current));
    const currentRequest = () =>
      scope.current(generation) &&
      providerRequests.current.get(provider) === ticket &&
      latestReload.current <= ticket;
    try {
      const response = await refreshAdminProvider(provider);
      if (currentRequest())
        setDashboard((current) => ({
          ...current,
          providers: current.providers.map((item) =>
            item.provider === provider ? response.provider : item,
          ),
          embeddingModel:
            latestModelRequest.current === ticket
              ? response.embedding_model
              : current.embeddingModel,
          descriptionModel:
            latestModelRequest.current === ticket
              ? response.description_model
              : current.descriptionModel,
        }));
    } catch (caught) {
      if (currentRequest()) fail(caught, "Could not refresh provider");
    } finally {
      if (
        scope.current(generation) &&
        providerRequests.current.get(provider) === ticket
      ) {
        refreshing.current.delete(provider);
        setRefreshing(new Set(refreshing.current));
      }
    }
  }
  function updateProvider(provider: ProviderDashboardStatus) {
    providerRequests.current.set(provider.provider, ++sequence.current);
    setDashboard((current) => ({
      ...current,
      providers: current.providers.map((item) =>
        item.provider === provider.provider ? provider : item,
      ),
    }));
  }
  useEffect(() => {
    if (enabled) void reload();
    else {
      setDashboard(EMPTY_DASHBOARD);
      setToasts([]);
      refreshing.current.clear();
      setRefreshing(new Set());
      setLoading(false);
      setError(null);
    }
  }, [enabled]);
  return {
    dashboard,
    isLoading,
    refreshingProviders,
    error,
    reload,
    refreshProvider,
    updateProvider,
    notify,
    toasts,
  };
}
