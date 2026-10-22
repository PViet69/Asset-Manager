import { Disclosure, DisclosurePanel, Heading } from "react-aria-components";
import { Button } from "../../components/ui/Button";
import { CheckboxField } from "../../components/ui/Fields";
import type { useApprovedTags } from "./useApprovedTags";
import styles from "./ApprovedTagsPanel.module.css";
export function ApprovedTagsPanel({
  model,
}: {
  model: ReturnType<typeof useApprovedTags>;
}): JSX.Element {
  const count = model.selected.length;
  return (
    <section className={styles.panel} aria-label="Approved tags">
      <h2>Approved tags</h2>
      <p>
        Discover indexed tags, then choose which tags appear in search filters.
      </p>
      <Button
        onPress={() => void model.discover()}
        isDisabled={model.isDiscovering || model.isLoading || model.isSaving}
      >
        {model.isDiscovering ? "Discovering tags…" : "Discover and index tags"}
      </Button>
      {model.isLoading ? (
        <p role="status">Loading approved tags…</p>
      ) : (
        <>
          <div className={styles.summary}>
            <strong>
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
          {model.groups.map((group) => (
            <Disclosure
              key={group.category}
              isExpanded={model.expandedCategories.has(group.category)}
              onExpandedChange={() => model.toggleCategory(group.category)}
              className={styles.category}
            >
              <Heading>
                <Button slot="trigger" variant="quiet">
                  {group.category}{" "}
                  {group.tags.filter((t) => model.selected.includes(t)).length}{" "}
                  selected
                </Button>
              </Heading>
              <DisclosurePanel className={styles.tags}>
                {group.tags.map((tag) => (
                  <CheckboxField
                    key={tag}
                    isSelected={model.selected.includes(tag)}
                    isDisabled={model.isSaving}
                    onChange={() => model.toggle(tag)}
                  >
                    {tag.includes(":") ? tag.slice(tag.indexOf(":") + 1) : tag}
                  </CheckboxField>
                ))}
              </DisclosurePanel>
            </Disclosure>
          ))}
          {model.groups.length === 0 && (
            <p>No approved tags yet. Discover tags to begin.</p>
          )}
          <Button
            variant="primary"
            onPress={() => void model.save()}
            isDisabled={model.isSaving || model.isDiscovering}
          >
            {model.isSaving ? "Saving approved tags" : "Save approved tags"}
          </Button>
        </>
      )}
    </section>
  );
}
