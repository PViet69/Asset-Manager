import {
  Tabs as AriaTabs,
  TabList as AriaTabList,
  Tab as AriaTab,
  TabPanel as AriaTabPanel,
} from "react-aria-components";
import styles from "./Tabs.module.css";

export function Tabs(
  props: React.ComponentProps<typeof AriaTabs>,
): JSX.Element {
  return (
    <AriaTabs
      {...props}
      className={(state) =>
        `${styles.tabs} ${typeof props.className === "function" ? props.className(state) : (props.className ?? "")}`
      }
    />
  );
}
export function TabList(
  props: React.ComponentProps<typeof AriaTabList>,
): JSX.Element {
  return (
    <AriaTabList
      {...props}
      className={(state) =>
        `${styles.list} ${typeof props.className === "function" ? props.className(state) : (props.className ?? "")}`
      }
    />
  );
}
export function Tab(props: React.ComponentProps<typeof AriaTab>): JSX.Element {
  return (
    <AriaTab
      {...props}
      className={(state) =>
        `${styles.tab} ${typeof props.className === "function" ? props.className(state) : (props.className ?? "")}`
      }
    />
  );
}
export function TabPanel(
  props: React.ComponentProps<typeof AriaTabPanel>,
): JSX.Element {
  return (
    <AriaTabPanel
      {...props}
      className={(state) =>
        `${styles.panel} ${typeof props.className === "function" ? props.className(state) : (props.className ?? "")}`
      }
    />
  );
}
