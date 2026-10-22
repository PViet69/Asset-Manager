import { SearchField, Label, Input } from "react-aria-components";
import { Button } from "../../components/ui/Button";
import { SelectField } from "../../components/ui/Fields";
import { Tabs, TabList, Tab, TabPanel } from "../../components/ui/Tabs";
import { ModelUnavailableDialog } from "../../components/ModelUnavailableDialog";
import { SearchFiltersDialog } from "./SearchFiltersDialog";
import { SearchResults } from "./SearchResults";
import { MAX_QUERY_LENGTH, useAssetSearch } from "./useAssetSearch";
import type { SearchMode, SearchPanelProps, SortOrder } from "./search.types";
import styles from "./SearchWorkspace.module.css";
export function SearchWorkspace(props: SearchPanelProps = {}) {
  const search = useAssetSearch(props);
  return (
    <section className={styles.workspace} aria-label="Asset search">
      <Tabs
        selectedKey={search.mode}
        onSelectionChange={(key) => search.setMode(key as SearchMode)}
      >
        <TabList aria-label="Search mode selector">
          <Tab id="semantic">Description Search</Tab>
          <Tab id="filename">Filename Search</Tab>
        </TabList>
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void search.submit();
          }}
        >
          <SearchField
            aria-label="Query"
            value={search.query}
            onChange={search.setQuery}
            className={styles.search}
          >
            <Label className={styles.srOnly}>Query</Label>
            <span aria-hidden="true" className={styles.searchIcon}>
              ⌕
            </span>
            <Input
              className={styles.input}
              maxLength={MAX_QUERY_LENGTH}
              autoComplete="off"
              placeholder={
                search.mode === "semantic"
                  ? "Describe the asset you’re looking for…"
                  : "Search by filename or extension…"
              }
            />
            {search.query && (
              <Button
                variant="quiet"
                aria-label="Clear search input"
                onPress={() => search.setQuery("")}
              >
                ×
              </Button>
            )}
          </SearchField>
          <Button type="submit" variant="primary">
            Search
          </Button>
          <SearchFiltersDialog
            value={search.filters}
            providers={search.providers}
            groups={search.tagGroups}
            onApply={search.applyFilters}
          />
        </form>
        {(["semantic", "filename"] as const).map((mode) => (
          <TabPanel key={mode} id={mode}>
            {search.state.kind === "result" && (
              <div className={styles.resultsHeader}>
                <h2>
                  Results{" "}
                  <span>
                    {search.sortedItems.length}{" "}
                    {search.sortedItems.length === 1 ? "match" : "matches"}
                  </span>
                </h2>
                {mode === "filename" && (
                  <SelectField
                    label="Sort by date"
                    value={search.sort}
                    options={[
                      { id: "relevance", label: "Default" },
                      { id: "date_desc", label: "Date: Newest first" },
                      { id: "date_asc", label: "Date: Oldest first" },
                    ]}
                    onChange={(value) => search.setSort(value as SortOrder)}
                  />
                )}
              </div>
            )}
            <SearchResults
              state={search.state}
              items={search.sortedItems}
              showScore={mode === "semantic"}
              onProviderChange={(provider) =>
                search.applyFilters({
                  ...search.filters,
                  provider:
                    search.filters.provider === provider ? "" : provider,
                })
              }
            />
          </TabPanel>
        ))}
      </Tabs>
      {search.state.kind === "error" &&
        search.state.message === "Model not found" && (
          <ModelUnavailableDialog onDismiss={search.dismissError} />
        )}
    </section>
  );
}
