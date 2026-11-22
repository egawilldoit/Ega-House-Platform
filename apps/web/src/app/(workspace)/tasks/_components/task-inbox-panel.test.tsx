// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  captureInboxIdea: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/tasks",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/inbox/capture-action", () => ({
  captureInboxIdea: mocks.captureInboxIdea,
}));

vi.mock("../inbox-actions", () => ({
  archiveTaskInboxItemAction: vi.fn(async () => ({
    error: null,
    success: "Idea archived.",
  })),
  convertTaskInboxItemAction: vi.fn(async () => ({ error: null })),
}));

import {
  createEmptyCaptureDraft,
  saveInboxCaptureDraft,
} from "@/lib/inbox-capture/draft-storage";
import { TaskInboxPanel } from "./task-inbox-panel";

const OWNER = "owner-1";

const idea = {
  id: "idea-1",
  title: "Explore onboarding insight",
  body: "Ask about the drop-off",
  status: "inbox" as const,
  type: "idea" as const,
  project_id: "project-1",
  priority: null,
  tags: [],
  created_at: "2026-05-01T09:00:00.000Z",
  updated_at: "2026-05-01T09:00:00.000Z",
  projects: { name: "EGA House" },
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.clear();
  mocks.refresh.mockReset();
  mocks.captureInboxIdea.mockReset();
  mocks.captureInboxIdea.mockResolvedValue({ ok: true, id: "idea-2" });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => {
    root.render(
      <TaskInboxPanel
        ideas={[idea]}
        projects={[{ id: "project-1", name: "EGA House" }]}
        ownerId={OWNER}
      />,
    );
  });
}

function setValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("TaskInboxPanel", () => {
  it("shows captured ideas with convert and archive affordances", async () => {
    await render();

    expect(container.textContent).toContain("Explore onboarding insight");
    expect(container.textContent).toContain("Turn into task");
    const archive = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Archive",
    );
    expect(archive).not.toBeNull();
  });

  it("captures a one-line idea through the canonical action and clears the draft", async () => {
    await render();

    const input = container.querySelector<HTMLInputElement>(
      "#task-inbox-capture-title",
    )!;
    await act(async () => setValue(input, "New insight"));

    const form = container.querySelector<HTMLFormElement>(
      '[data-testid="task-inbox-capture"]',
    )!;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    expect(mocks.captureInboxIdea).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "New insight",
        projectId: null,
      }),
    );
    expect(mocks.refresh).toHaveBeenCalled();
    expect(
      window.localStorage.getItem(`ega:inbox-capture-draft:${OWNER}`),
    ).toBeNull();
  });

  it("recovers an unsaved owner-scoped draft on mount", async () => {
    const draft = {
      ...createEmptyCaptureDraft(),
      title: "Recovered draft",
      projectId: "project-1",
    };
    saveInboxCaptureDraft(OWNER, draft);

    await render();

    const input = container.querySelector<HTMLInputElement>(
      "#task-inbox-capture-title",
    )!;
    expect(input.value).toBe("Recovered draft");
  });
});
