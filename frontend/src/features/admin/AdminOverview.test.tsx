import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { AdminOverview } from "./AdminOverview";
import { AdminProviders } from "./AdminProviders";
afterEach(cleanup);
const dashboard = {
  providers: [
    {
      provider: "drive",
      display_name: "Drive",
      enabled: true,
      health: "ok",
      detected_count: null,
      embedded_count: 5,
    },
  ],
  embeddingModel: null,
  descriptionModel: null,
};
test("null counts show unavailable rather than zero or fabricated percentages", () => {
  render(<AdminOverview dashboard={dashboard} isLoading={false} />);
  expect(screen.getAllByText("Unavailable")).toHaveLength(2);
  expect(screen.getByText("5")).toBeInTheDocument();
  expect(screen.queryByText("0%")).not.toBeInTheDocument();
});
test("empty provider list explains how to refresh", () => {
  render(
    <AdminProviders
      dashboard={{ ...dashboard, providers: [] }}
      controls={{
        refreshingProviders: new Set(),
        syncingProviders: new Set(),
        stoppingProviders: new Set(),
        onBrowse: () => {},
        onRefresh: () => {},
        onStart: () => {},
        onStop: () => {},
      }}
    />,
  );
  expect(screen.getByText(/No storage providers/)).toHaveTextContent(
    "Refresh status in Settings",
  );
});
test("provider loading transitions to the real empty state", () => {
  const props = { dashboard: { ...dashboard, providers: [] }, controls: { refreshingProviders: new Set<string>(), syncingProviders: new Set<string>(), stoppingProviders: new Set<string>(), onBrowse: () => {}, onRefresh: () => {}, onStart: () => {}, onStop: () => {} } };
  const { rerender } = render(<AdminProviders {...props} isLoading />);
  expect(screen.getByRole("status")).toHaveTextContent("Loading storage providers");
  expect(screen.queryByText(/No storage providers/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  rerender(<AdminProviders {...props} isLoading={false} />);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getByText(/No storage providers/)).toBeInTheDocument();
});
