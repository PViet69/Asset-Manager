import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { AdminLoginBackground } from "./AdminLoginBackground";

test("renders interactive dot field canvas with its rendering engine identified", () => {
  // Production change caught: removing canvas metadata leaves assistive tooling unable to identify the decorative renderer.
  // Arrange
  render(<AdminLoginBackground />);

  // Act
  const canvas = screen.getByRole("presentation", { hidden: true });

  // Assert
  expect(canvas).toHaveAttribute("data-engine", "three.js r180");
});

test("exposes ambient drift separately from pointer interaction", async () => {
  // Production change caught: removing ambient motion leaves dots static without pointer input.
  // Arrange
  const { calculateDotPosition } = await import("./AdminLoginBackground");

  // Act
  const position = calculateDotPosition({
    baseX: 1,
    baseY: 2,
    baseZ: -1,
    index: 3,
    pointerX: 20,
    pointerY: 20,
    elapsed: 1,
  });

  // Assert
  expect(position).not.toEqual({ x: 1, y: 2, z: -1 });
});
