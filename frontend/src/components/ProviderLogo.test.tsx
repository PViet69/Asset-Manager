import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { ProviderLogo } from "./ProviderLogo";

afterEach(cleanup);

test("renders Google Drive logo for google_drive provider", () => {
  render(<ProviderLogo provider="google_drive" />);
  expect(screen.getByLabelText("Google Drive")).toBeInTheDocument();
});

test("renders Dropbox logo for dropbox provider", () => {
  render(<ProviderLogo provider="dropbox" />);
  expect(screen.getByLabelText("Dropbox")).toBeInTheDocument();
});

test("renders generic fallback logo for unknown provider", () => {
  render(<ProviderLogo provider="s3_custom" />);
  expect(screen.getByLabelText("s3_custom storage provider")).toBeInTheDocument();
});
