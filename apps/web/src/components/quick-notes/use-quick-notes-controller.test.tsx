// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  captureInboxIdea: vi.fn(),
  routerRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.routerRefresh }),
}));

vi.mock("@/components/inbox/capture-action", () => ({
  captureInboxIdea: mocks.captureInboxIdea,
}));

import { useQuickNotesController } from "./use-quick-notes-controller";
import { quickNotesStorageKey } from "@/lib/quick-notes/draft-storage";

let typedText = "";
let container: HTMLDivElement;
let root: Root;

function Harness({ ownerUserId }: { ownerUserId: string | null }) {
  const notes = useQuickNotesController(ownerUserId);
  return (
    <div>
      <textarea aria-label="scratch" value={notes.text} readOnly />
      <span data-testid="status">{notes.status}</span>
      <span data-testid="error">{notes.error ?? ""}</span>
      <span data-testid="confirm">{String(notes.confirmNewNote)}</span>
      <button data-testid="type" onClick={() => notes.setText(typedText)} />
      <button data-testid="save" onClick={notes.save} />
      <button data-testid="new" onClick={notes.requestNewNote} />
      <button data-testid="confirm-new" onClick={notes.confirmNewNoteAction} />
      <button data-testid="cancel-new" onClick={notes.cancelNewNote} />
    </div>
  );
}

function mount(ownerUserId: string | null = "owner-a") {
  act(() => {
    root.render(<Harness ownerUserId={ownerUserId} />);
  });
}

function click(testId: string) {
  act(() => {
    document.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)?.click();
  });
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function scratch() {
  return document.querySelector<HTMLTextAreaElement>('textarea[aria-label="scratch"]');
}

function stored(ownerUserId = "owner-a") {
  const raw = window.localStorage.getItem(quickNotesStorageKey(ownerUserId)!);
  return raw ? (JSON.parse(raw) as { text: string; idempotencyKey: string; keyText: string }) : null;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  window.localStorage.clear();
  typedText = "";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  mocks.captureInboxIdea.mockReset();
  mocks.routerRefresh.mockReset();
  mocks.captureInboxIdea.mockResolvedValue({ ok: true, id: "note-1" });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("quick notes controller", () => {
  it("restores only the current owner's draft as unsaved changes", () => {
    window.localStorage.setItem(
      quickNotesStorageKey("owner-a")!,
      JSON.stringify({
        text: "first line\nsecond line",
        idempotencyKey: "owner-a-key",
        keyText: "first line\nsecond line",
      }),
    );
    window.localStorage.setItem(
      quickNotesStorageKey("owner-b")!,
      JSON.stringify({
        text: "other owner",
        idempotencyKey: "owner-b-key",
        keyText: "other owner",
      }),
    );

    mount("owner-a");
    expect(scratch()?.value).toBe("first line\nsecond line");
    expect(document.querySelector('[data-testid="status"]')?.textContent).toBe(
      "unsaved",
    );
    expect(document.body.textContent).not.toContain("other owner");
  });

  it("saves the derived title and full body, then clears only the acknowledged draft", async () => {
    mount();
    typedText = "  \nBuild the floating notes \nline two\nline three";
    click("type");
    const key = stored()?.idempotencyKey;

    await act(async () => {
      click("save");
    });
    await settle();

    expect(mocks.captureInboxIdea).toHaveBeenCalledTimes(1);
    expect(mocks.captureInboxIdea).toHaveBeenCalledWith({
      title: "Build the floating notes",
      body: "  \nBuild the floating notes \nline two\nline three",
      idempotencyKey: key,
    });
    expect(stored()).toBeNull();
    expect(scratch()?.value).toBe("");
    expect(document.querySelector('[data-testid="status"]')?.textContent).toBe(
      "saved-to-backlog",
    );
    expect(mocks.routerRefresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the draft and payload key on failure, and rotates the key when edited", async () => {
    mocks.captureInboxIdea
      .mockResolvedValueOnce({ ok: false, error: "Network unavailable." })
      .mockResolvedValueOnce({ ok: false, error: "Network unavailable." })
      .mockResolvedValueOnce({ ok: true, id: "note-2" });

    mount();
    typedText = "do not lose me";
    click("type");
    const firstKey = stored()?.idempotencyKey;

    await act(async () => {
      click("save");
    });
    await settle();

    expect(document.querySelector('[data-testid="status"]')?.textContent).toBe(
      "error",
    );
    expect(document.querySelector('[data-testid="error"]')?.textContent).toBe(
      "Network unavailable.",
    );
    expect(scratch()?.value).toBe("do not lose me");
    expect(stored()?.idempotencyKey).toBe(firstKey);

    await act(async () => {
      click("save");
    });
    await settle();
    expect(mocks.captureInboxIdea.mock.calls[1]?.[0].idempotencyKey).toBe(
      firstKey,
    );

    typedText = "do not lose me - edited";
    click("type");
    const secondKey = stored()?.idempotencyKey;
    expect(secondKey).not.toBe(firstKey);

    await act(async () => {
      click("save");
    });
    await settle();
    expect(mocks.captureInboxIdea.mock.calls[2]?.[0].idempotencyKey).toBe(
      secondKey,
    );
    expect(mocks.captureInboxIdea.mock.calls[2]?.[0].body).toBe(
      "do not lose me - edited",
    );
    expect(stored()).toBeNull();
  });

  it("ignores a second save click while one is in flight", async () => {
    let resolveSave!: (value: unknown) => void;
    mocks.captureInboxIdea.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );

    mount();
    typedText = "single save";
    click("type");

    await act(async () => {
      click("save");
      click("save");
    });
    expect(mocks.captureInboxIdea).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSave({ ok: true, id: "note-3" });
      await Promise.resolve();
    });
    expect(mocks.captureInboxIdea).toHaveBeenCalledTimes(1);
  });

  it("warns before discarding meaningful unsaved text", () => {
    mount();
    typedText = "keep this";
    click("type");
    click("new");

    expect(document.querySelector('[data-testid="confirm"]')?.textContent).toBe(
      "true",
    );
    expect(scratch()?.value).toBe("keep this");

    click("cancel-new");
    expect(document.querySelector('[data-testid="confirm"]')?.textContent).toBe(
      "false",
    );
    expect(scratch()?.value).toBe("keep this");

    click("new");
    click("confirm-new");
    expect(scratch()?.value).toBe("");
    expect(stored()).toBeNull();
    expect(document.querySelector('[data-testid="status"]')?.textContent).toBe(
      "saved-locally",
    );
  });

  it("drops the previous owner's live draft on account switch", () => {
    mount("owner-a");
    typedText = "owner a secret";
    click("type");
    expect(scratch()?.value).toBe("owner a secret");

    // The workspace layout keys the provider by owner, so a switch remounts.
    act(() => {
      root.unmount();
    });
    root = createRoot(container);
    act(() => {
      root.render(<Harness ownerUserId="owner-b" />);
    });

    expect(scratch()?.value).toBe("");
    expect(document.body.textContent).not.toContain("owner a secret");
    expect(loadViaStorage("owner-a")).toBe("owner a secret");
    expect(loadViaStorage("owner-b")).toBe("");
  });
});

function loadViaStorage(owner: string) {
  const raw = window.localStorage.getItem(quickNotesStorageKey(owner)!);
  return raw ? (JSON.parse(raw) as { text: string }).text : "";
}
