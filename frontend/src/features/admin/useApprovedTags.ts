import { useEffect, useState } from "react";
import {
  discoverAdminTags,
  getAdminTags,
  saveAdminTags,
} from "../../api/client";
import type { TagGroup } from "../../types";
import type { ControllerOptions } from "./admin.types";
import { useRequestScope } from "./useRequestScope";
export function useApprovedTags({
  enabled,
  onError,
  notify,
}: ControllerOptions & {
  notify(message: string, type: "status" | "error"): void;
}) {
  const [groups, setGroups] = useState<readonly TagGroup[]>([]);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [expandedCategories, setExpanded] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [isLoading, setLoading] = useState(false);
  const [isDiscovering, setDiscovering] = useState(false);
  const [isSaving, setSaving] = useState(false);
  const scope = useRequestScope(enabled);
  useEffect(() => {
    if (!enabled) {
      setGroups([]);
      setSelected([]);
      setExpanded(new Set());
      setLoading(false);
      setDiscovering(false);
      setSaving(false);
      return;
    }
    const id = scope.capture();
    setLoading(true);
    getAdminTags()
      .then(
        (r) => {
          if (scope.current(id)) {
            setGroups(r.groups);
            setSelected(r.groups.flatMap((g) => g.tags));
            setExpanded(new Set(r.groups.map((g) => g.category)));
          }
        },
        (e) => {
          if (scope.current(id)) onError(e, "Could not load approved tags");
        },
      )
      .finally(() => {
        if (scope.current(id)) setLoading(false);
      });
  }, [enabled]);
  async function discover() {
    if (!enabled || isDiscovering || isLoading) return;
    const id = scope.capture();
    setDiscovering(true);
    try {
      const r = await discoverAdminTags();
      if (scope.current(id)) {
        const valid = new Set(r.groups.flatMap((g) => g.tags));
        const approved = selected.filter((t) => valid.has(t));
        setGroups(r.groups);
        setSelected(approved);
        setExpanded(
          (s) =>
            new Set([
              ...s,
              ...r.groups
                .filter((g) => g.tags.some((t) => approved.includes(t)))
                .map((g) => g.category),
            ]),
        );
        notify(`Indexed tags for ${r.indexed_assets} assets.`, "status");
      }
    } catch (e) {
      if (scope.current(id)) onError(e, "Could not discover tags");
    } finally {
      if (scope.current(id)) setDiscovering(false);
    }
  }
  async function save() {
    if (!enabled || isSaving) return;
    const id = scope.capture();
    setSaving(true);
    try {
      const r = await saveAdminTags(
        groups.flatMap((g) => g.tags),
        selected,
      );
      if (scope.current(id)) {
        setSelected(r.groups.flatMap((g) => g.tags));
        notify("Approved tags saved.", "status");
      }
    } catch (e) {
      if (scope.current(id)) onError(e, "Could not save approved tags");
    } finally {
      if (scope.current(id)) setSaving(false);
    }
  }
  return {
    groups,
    selected,
    expandedCategories,
    isLoading,
    isDiscovering,
    isSaving,
    discover,
    save,
    toggle: (tag: string) =>
      setSelected((s) =>
        s.includes(tag) ? s.filter((t) => t !== tag) : [...s, tag],
      ),
    toggleCategory: (category: string) =>
      setExpanded((s) => {
        const next = new Set(s);
        if (next.has(category)) next.delete(category);
        else next.add(category);
        return next;
      }),
    clear: () => setSelected([]),
  };
}
