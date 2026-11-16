// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearQuickNoteDraft,
  clearQuickNoteDraftIfUnchanged,
  createEmptyDraft,
  createIdempotencyKey,
  deriveNoteTitle,
  loadQuickNoteDraft,
  quickNotesStorageKey,
  saveQuickNoteDraft,
} from "./draft-storage";

describe("quick notes draft storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("never reads or writes a draft without a verified owner", () => {
    expect(quickNotesStorageKey(null)).toBeNull();
    expect(quickNotesStorageKey("")).toBeNull();

    const draft = { ...createEmptyDraft(), text: "private thought" };
    saveQuickNoteDraft(null, draft);
    clearQuickNoteDraft(null);

    expect(window.localStorage.length).toBe(0);
    expect(loadQuickNoteDraft(null)).toBeNull();
  });

  it("isolates drafts by authenticated owner", () => {
    saveQuickNoteDraft("owner-a", { ...createEmptyDraft(), text: "A draft" });
    saveQuickNoteDraft("owner-b", { ...createEmptyDraft(), text: "B draft" });

    expect(loadQuickNoteDraft("owner-a")?.text).toBe("A draft");
    expect(loadQuickNoteDraft("owner-b")?.text).toBe("B draft");

    clearQuickNoteDraft("owner-a");
    expect(loadQuickNoteDraft("owner-a")).toBeNull();
    expect(loadQuickNoteDraft("owner-b")?.text).toBe("B draft");
  });

  it("keeps the idempotency key paired with the exact draft text", () => {
    const draft = {
      text: "line one\nline two",
      idempotencyKey: "key-for-this-text",
      keyText: "line one\nline two",
    };
    saveQuickNoteDraft("owner-a", draft);
    const loaded = loadQuickNoteDraft("owner-a");

    expect(loaded).toEqual(draft);
  });

  it("repairs malformed or partial stored drafts without leaking text", () => {
    window.localStorage.setItem(quickNotesStorageKey("owner-a")!, "not json");
    expect(loadQuickNoteDraft("owner-a")).toBeNull();

    window.localStorage.setItem(
      quickNotesStorageKey("owner-a")!,
      JSON.stringify({ text: "recovered", idempotencyKey: "" }),
    );
    const repaired = loadQuickNoteDraft("owner-a");
    expect(repaired?.text).toBe("recovered");
    expect(repaired?.keyText).toBe("recovered");
    expect(repaired?.idempotencyKey.length).toBeGreaterThan(0);
    expect(repaired?.idempotencyKey).not.toContain("\n");
  });

  it("clears only the exact draft across competing workspace tabs", () => {
    const acknowledged = {
      text: "shared text",
      idempotencyKey: "old-key",
      keyText: "shared text",
    };
    saveQuickNoteDraft("owner-a", acknowledged);

    // Another tab wrote a newer draft under the same owner key.
    saveQuickNoteDraft("owner-a", {
      text: "newer text",
      idempotencyKey: "new-key",
      keyText: "newer text",
    });
    clearQuickNoteDraftIfUnchanged("owner-a", acknowledged);

    expect(loadQuickNoteDraft("owner-a")?.text).toBe("newer text");

    clearQuickNoteDraftIfUnchanged("owner-a", {
      text: "newer text",
      idempotencyKey: "new-key",
      keyText: "newer text",
    });
    expect(loadQuickNoteDraft("owner-a")).toBeNull();
  });

  it("generates distinct bounded idempotency keys", () => {
    const first = createIdempotencyKey();
    const second = createIdempotencyKey();

    expect(first).not.toBe(second);
    expect(first.length).toBeLessThanOrEqual(128);
    expect(/[\0-\x1f\x7f]/.test(first)).toBe(false);
  });

  it("derives a bounded title from the first nonempty line", () => {
    expect(deriveNoteTitle("  \n  Ship quick notes \nrest of body")).toBe(
      "Ship quick notes",
    );
    expect(deriveNoteTitle("   \n\t\n")).toBe("Quick note");
    expect(deriveNoteTitle("")).toBe("Quick note");

    const longTitle = deriveNoteTitle("x".repeat(120));
    expect(longTitle.length).toBe(80);
    expect(longTitle.endsWith("…")).toBe(true);
    expect(longTitle.startsWith("x")).toBe(true);
  });
});
