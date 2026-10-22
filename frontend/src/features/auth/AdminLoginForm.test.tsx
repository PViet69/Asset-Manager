import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { AdminLoginForm } from "./AdminLoginForm";
afterEach(cleanup);
test("native form submits username and password and indicates submission", async () => {
  const user = userEvent.setup();
  const login = vi.fn().mockResolvedValue(undefined);
  const session = {
    status: "anonymous" as const,
    error: null,
    isSubmitting: false,
    login,
    logout: vi.fn(),
    expire: vi.fn(),
    clearError: vi.fn(),
  };
  const { rerender } = render(<AdminLoginForm session={session} />);
  await user.type(screen.getByLabelText("Username"), "admin");
  await user.type(screen.getByLabelText("Password"), "password");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  expect(login).toHaveBeenCalledWith("admin", "password");
  rerender(<AdminLoginForm session={{ ...session, isSubmitting: true }} />);
  expect(screen.getByRole("button", { name: "Signing in…" })).toBeDisabled();
});
