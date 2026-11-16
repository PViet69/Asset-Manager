import { Spinner } from "../../components/ui/Spinner";
import { useState } from "react";
import { Disclosure, DisclosurePanel, Heading, Checkbox, SearchField, Label, Input } from "react-aria-components";
import { Button } from "../../components/ui/Button";
import type { useApprovedTags } from "./useApprovedTags";
import styles from "./ApprovedTagsPanel.module.css";
export function ApprovedTagsPanel({
  model,
}: {
  model: ReturnType<typeof useApprovedTags>;
}): JSX.Element {
  const [query, setQuery] = useState("");
  const count = model.selected.length;
  const total = model.groups.reduce((n, group) => n + group.tags.length, 0);
  const filtered = model.groups.map(group => ({...group, tags: group.tags.filter(tag => (tag + " " + group.category).toLowerCase().includes(query.trim().toLowerCase()))})).filter(group => group.tags.length);
  return (
    <section className={styles.panel} aria-label="Approved tags">
      <header className={styles.header}>
      <div><h2>Approved tags</h2><p>Choose the tags people can use to find assets.</p></div>
      <Button
        onPress={() => void model.discover()}
        isDisabled={model.isDiscovering || model.isLoading || model.isSaving}
      >
        {model.isDiscovering ? <Spinner label="Discovering tags" small /> : "Discover and index tags"}
      </Button>
      </header>
      {model.isLoading ? (
        <Spinner label="Loading approved tags" />
      ) : (
        <>
          <div className={styles.toolbar}>
            <SearchField value={query} onChange={setQuery} className={styles.search}><Label className={styles.srOnly}>Find approved tags</Label><span aria-hidden="true">⌕</span><Input type="search" placeholder="Find a tag or category…" /></SearchField>
            <span className={styles.total}>{total} tags / {model.groups.length} categories</span>
          </div>
          <div className={styles.summary}>
            <strong aria-live="polite">
              {count
                ? `${count} ${count === 1 ? "tag" : "tags"} selected`
                : "No tags selected"}
            </strong>
            <Button
              variant="quiet"
              onPress={model.clear}
              isDisabled={!count || model.isSaving}
            >
              Clear selection
            </Button>
          </div>
          <div className={styles.categories}>
          {filtered.map((group) => (
            <Disclosure
              key={group.category}
              isExpanded={!!query.trim() || model.expandedCategories.has(group.category)}
              onExpandedChange={() => model.toggleCategory(group.category)}
              className={styles.category}
            >
              <Heading>
                <Button slot="trigger" variant="quiet">
                  <span>{group.category}</span>
                  <span className={styles.categoryCount}>{group.tags.filter((t) => model.selected.includes(t)).length} selected / {group.tags.length}</span>
                </Button>
              </Heading>
              <DisclosurePanel className={styles.tags}>
                {group.tags.map((tag) => (
                  <Checkbox
                    className={styles.tag}
                    key={tag}
                    isSelected={model.selected.includes(tag)}
                    isDisabled={model.isSaving}
                    onChange={() => model.toggle(tag)}
                  >
                    <span className={styles.check} aria-hidden="true" />
                    {tag.includes(":") ? tag.slice(tag.indexOf(":") + 1) : tag}
                  </Checkbox>
                ))}
              </DisclosurePanel>
            </Disclosure>
          ))}
          </div>
          {!!model.groups.length && !filtered.length && <p className={styles.empty}>No tags match “{query}”.</p>}
          {model.groups.length === 0 && (
            <p>No approved tags yet. Discover tags to begin.</p>
          )}
          <footer className={styles.footer}>
          <span>Changes apply to search filters after saving.</span>
          <Button
            variant="primary"
            onPress={() => void model.save()}
            isDisabled={model.isSaving || model.isDiscovering}
          >
            {model.isSaving ? <Spinner label="Saving approved tags" small /> : "Save approved tags"}
          </Button>
          </footer>
        </>
      )}
    </section>
  );
}
