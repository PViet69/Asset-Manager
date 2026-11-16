import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { useState } from "react";
import { Button } from "./Button";
import { TextField } from "./Fields";
import { Dialog } from "./Dialog";
import { Tabs, TabList, Tab, TabPanel } from "./Tabs";

afterEach(cleanup);

test("disabled controls ignore presses and fields expose their label and changes", async () => {
  const press = vi.fn();
  const change = vi.fn();
  render(
    <>
      <Button isDisabled onPress={press}>
        Save
      </Button>
      <TextField label="Username" onChange={change} />
    </>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(press).not.toHaveBeenCalled();
  await userEvent.type(screen.getByRole("textbox", { name: "Username" }), "a");
  expect(change).toHaveBeenCalledWith("a");
});

test("dialog dismissal restores focus to its trigger", async () => {
  function Example() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button onPress={() => setOpen(true)}>Open</Button>
        <Dialog isOpen={open} onOpenChange={setOpen} title="Filters">
          <Button>Apply</Button>
        </Dialog>
      </>
    );
  }
  render(<Example />);
  const trigger = screen.getByRole("button", { name: "Open" });
  await userEvent.click(trigger);
  expect(screen.getByRole("dialog", { name: "Filters" })).toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  await waitFor(() => expect(trigger).toHaveFocus());
});

test("arrow keys switch tabs and their associated panels", async () => {
  render(
    <Tabs>
      <TabList aria-label="Mode">
        <Tab id="one">One</Tab>
        <Tab id="two">Two</Tab>
      </TabList>
      <TabPanel id="one">First</TabPanel>
      <TabPanel id="two">Second</TabPanel>
    </Tabs>,
  );
  await userEvent.click(screen.getByRole("tab", { name: "One" }));
  await userEvent.keyboard("{ArrowRight}");
  expect(screen.getByRole("tab", { name: "Two" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.getByRole("tabpanel")).toHaveTextContent("Second");
});
