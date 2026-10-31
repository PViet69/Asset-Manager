import { useState } from "react";
import { Checkbox, SearchField, Input, Label } from "react-aria-components";
import { Button } from "../../components/ui/Button";
import { ProviderLogo } from "../../components/ProviderLogo";
import { Dialog } from "../../components/ui/Dialog";
import { SelectField } from "../../components/ui/Fields";
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
  const [tagQuery, setTagQuery] = useState("");
  const visibleGroups = groups.map(group => ({ ...group, tags: group.tags.filter(tag => (tag.split(":", 2)[1] ?? tag).toLowerCase().includes(tagQuery.trim().toLowerCase())) })).filter(group => group.tags.length);
  const [page, setPage] = useState(0);
  const pages = visibleGroups.flatMap(group => Array.from({ length: Math.ceil(group.tags.length / 6) }, (_, index) => ({ ...group, tags: group.tags.slice(index * 6, index * 6 + 6) })));
  const currentPage = Math.min(page, Math.max(0, pages.length - 1));
  const count = value.tags.length + Number(Boolean(value.provider));
  return (
    <div className={styles.entry}>
      <Button
        aria-expanded={open}
        onPress={() => {
          setDraft({ provider: value.provider, tags: [...value.tags] });
          setTagQuery("");
          setPage(0);
          setOpen(true);
        }}
      >
        Filters{count > 0 ? ` (${count})` : ""}
      </Button>
      {count > 0 && <span className={styles.summary}>{count} applied</span>}
      <Dialog isOpen={open} onOpenChange={setOpen} title="Filters">
        <div className={styles.intro}><p>Choose a source and the tags that matter.</p><Button variant="quiet" aria-label="Close filters" onPress={() => setOpen(false)}>×</Button></div>
        <div className={styles.body}>
          <div className={styles.provider}><span className={styles.sectionLabel}>Storage provider</span>
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
              ...providers.map((p) => ({ id: p.id, label: p.displayName, icon: <ProviderLogo provider={p.id} size={18} aria-hidden="true" /> })),
            ]}
          />
          </div>
          <div className={styles.tagHeading}><span className={styles.sectionLabel}>Tags</span><span aria-live="polite">{draft.tags.length} selected</span></div>
          <SearchField value={tagQuery} onChange={query => { setTagQuery(query); setPage(0); }} className={styles.tagSearch}><Label className={styles.srOnly}>Find tags</Label><span aria-hidden="true">⌕</span><Input type="search" placeholder="Find a tag…" /></SearchField>
          <div className={styles.categories}>
          {pages.slice(currentPage, currentPage + 1).map((group) => (
            <fieldset className={styles.group} key={group.category}>
              <legend>{group.category}<span>{group.tags.filter(tag => draft.tags.includes(tag)).length || ""}</span></legend>
              <div className={styles.tags}>
                {group.tags.map((tag) => (
                  <Checkbox
                    className={styles.tag}
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
                    <span className={styles.tagCheck} aria-hidden="true" />{tag.split(":", 2)[1] ?? tag}
                  </Checkbox>
                ))}
              </div>
            </fieldset>
          ))}
          {!!groups.length && !visibleGroups.length && <p className={styles.empty}>No tags match “{tagQuery}”.</p>}
          {!groups.length && (
            <p className={styles.summary}>No approved tags available.</p>
          )}
          </div>
          {pages.length > 1 && <nav className={styles.pagination} aria-label="Tag pages"><Button isDisabled={currentPage === 0} onPress={() => setPage(currentPage - 1)}>Previous</Button><span aria-live="polite">{currentPage + 1} / {pages.length}</span><Button isDisabled={currentPage === pages.length - 1} onPress={() => setPage(currentPage + 1)}>Next</Button></nav>}
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
