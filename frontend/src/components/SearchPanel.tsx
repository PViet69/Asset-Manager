import { SearchWorkspace } from "../features/search/SearchWorkspace";
import type { SearchPanelProps } from "../features/search/search.types";
export type { SearchPanelProps } from "../features/search/search.types";
export function SearchPanel(props: SearchPanelProps = {}): JSX.Element {
  return <SearchWorkspace {...props} />;
}
