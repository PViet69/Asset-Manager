import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { AdminModelHealth } from "./AdminModelHealth";
afterEach(cleanup);

test("shows image and video description models separately", () => {
  const { container } = render(<AdminModelHealth embeddingModel={{name:"embed",health:"ok"}} descriptionModel={{name:"deepseek-flash",health:"ok"}} videoModel={{name:"gemini-video",health:"ok"}} />);
  expect(screen.getByText("Image descriptions")).toBeInTheDocument();
  expect(screen.getByText("Video descriptions")).toBeInTheDocument();
  expect(screen.getByRole("heading", {name:"deepseek-flash"})).toBeInTheDocument();
  expect(screen.getByRole("heading", {name:"gemini-video"})).toBeInTheDocument();
  expect(container.querySelectorAll('[data-status="ready"]')).toHaveLength(3);
});

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
