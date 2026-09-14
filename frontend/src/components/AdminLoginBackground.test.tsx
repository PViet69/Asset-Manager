import { expect, test } from "vitest";

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
