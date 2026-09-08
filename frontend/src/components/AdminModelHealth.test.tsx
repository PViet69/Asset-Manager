import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { AdminModelHealth } from "./AdminModelHealth";

test("shows available model names and health", () => {
  render(
    <AdminModelHealth
      embeddingModel={{ name: "nomic-embed-text", health: "ok" }}
      descriptionModel={{ name: "llava:latest", health: "unavailable" }}
    />
  );

  expect(screen.getByRole("region", { name: "Model health" })).toHaveTextContent("nomic-embed-text");
  expect(screen.getByRole("region", { name: "Model health" })).toHaveTextContent("Unavailable");
});
