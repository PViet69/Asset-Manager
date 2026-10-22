import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { CheckboxField, SelectField } from "../../components/ui/Fields";
import type { ProviderMeta, TagGroup } from "../../types";
import type { SearchFilters } from "./search.types";
import styles from "./SearchFiltersDialog.module.css";
export function SearchFiltersDialog({
  value,
  providers,
  groups,
  onApply,
}: {
  value: SearchFilters;
  providers: readonly ProviderMeta[];
  groups: readonly TagGroup[];
  onApply(value: SearchFilters): void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const count = value.tags.length + Number(Boolean(value.provider));
  return (
    <div className={styles.entry}>
      <Button
        aria-expanded={open}
        onPress={() => {
          setDraft({ provider: value.provider, tags: [...value.tags] });
          setOpen(true);
        }}
      >
        Filters{count > 0 ? ` (${count})` : ""}
      </Button>
      {count > 0 && <span className={styles.summary}>{count} applied</span>}
      <Dialog isOpen={open} onOpenChange={setOpen} title="Filters">
        <div className={styles.body}>
          <SelectField
            label="Provider"
            value={draft.provider || "all"}
            onChange={(provider) =>
              setDraft({
                ...draft,
                provider: provider === "all" ? "" : provider,
              })
            }
            options={[
              { id: "all", label: "All providers" },
              ...providers.map((p) => ({ id: p.id, label: p.displayName })),
            ]}
          />
          {groups.map((group) => (
            <fieldset className={styles.group} key={group.category}>
              <legend>{group.category}</legend>
              <div className={styles.tags}>
                {group.tags.map((tag) => (
                  <CheckboxField
                    key={tag}
                    isSelected={draft.tags.includes(tag)}
                    onChange={(selected) =>
                      setDraft({
                        ...draft,
                        tags: selected
                          ? [...draft.tags, tag]
                          : draft.tags.filter((t) => t !== tag),
                      })
                    }
                  >
                    {tag.split(":", 2)[1] ?? tag}
                  </CheckboxField>
                ))}
              </div>
            </fieldset>
          ))}
          {!groups.length && (
            <p className={styles.summary}>No approved tags available.</p>
          )}
        </div>
        <div className={styles.actions}>
          <Button
            variant="quiet"
            onPress={() => setDraft({ provider: "", tags: [] })}
          >
            Clear filters
          </Button>
          <span />
          <Button onPress={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="primary"
            onPress={() => {
              onApply(draft);
              setOpen(false);
            }}
          >
            Apply
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
