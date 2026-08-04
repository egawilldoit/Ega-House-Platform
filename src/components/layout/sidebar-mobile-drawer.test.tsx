import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { WorkspaceNavigationDrawer } from "./sidebar-mobile-drawer";

afterEach(() => {
  document.body.style.overflow = "";
});

describe("WorkspaceNavigationDrawer", () => {
  it("opens with correct ARIA state, moves focus inside, and restores focus on Escape", async () => {
    render(
      <WorkspaceNavigationDrawer>
        <a href="/dashboard">Dashboard</a>
      </WorkspaceNavigationDrawer>,
    );

    const trigger = screen.getByRole("button", { name: "Open workspace navigation" });
    trigger.focus();
    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog", { name: "Workspace navigation" })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe("hidden");

    await waitFor(() => expect(screen.getByRole("link", { name: "Dashboard" })).toHaveFocus());

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Workspace navigation" })).not.toBeInTheDocument());
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
  });

  it("closes from the backdrop and from navigation", async () => {
    render(
      <WorkspaceNavigationDrawer>
        <a href="/dashboard">Dashboard</a>
      </WorkspaceNavigationDrawer>,
    );

    const trigger = screen.getByRole("button", { name: "Open workspace navigation" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Close workspace navigation" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Workspace navigation" })).not.toBeInTheDocument());

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("link", { name: "Dashboard" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Workspace navigation" })).not.toBeInTheDocument());
  });
});
