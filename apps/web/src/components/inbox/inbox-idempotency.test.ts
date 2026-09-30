import { describe, it, expect, beforeEach } from "vitest";
import {
  loadDraft,
  saveDraft,
  clearDraftStorage,
  createIdempotencyKey,
  DRAFT_STORAGE_KEY,
} from "./inbox-capture-sheet";

describe("Backlog draft idempotency key normalization", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("preserves a valid persisted idempotency key", () => {
    window.localStorage.setItem(
      DRAFT_STORAGE_KEY,
      JSON.stringify({
        title: "Test Idea",
        body: "Some details",
        projectId: "proj-1",
        idempotencyKey: "custom-key-123",
      })
    );

    const draft = loadDraft();
    expect(draft).not.toBeNull();
    expect(draft?.idempotencyKey).toBe("custom-key-123");
  });

  it("trims surrounding whitespace from a persisted idempotency key", () => {
    window.localStorage.setItem(
      DRAFT_STORAGE_KEY,
      JSON.stringify({
        title: "Test Idea",
        body: "Some details",
        projectId: "proj-1",
        idempotencyKey: "   padded-key-456   ",
      })
    );

    const draft = loadDraft();
    expect(draft).not.toBeNull();
    expect(draft?.idempotencyKey).toBe("padded-key-456");
  });

  it("replaces whitespace-only key with a newly generated valid key", () => {
    window.localStorage.setItem(
      DRAFT_STORAGE_KEY,
      JSON.stringify({
        title: "Test Idea",
        body: "Some details",
        projectId: "proj-1",
        idempotencyKey: "     ",
      })
    );

    const draft = loadDraft();
    expect(draft).not.toBeNull();
    expect(draft?.idempotencyKey).toBeTruthy();
    expect(draft?.idempotencyKey.trim().length).toBeGreaterThan(0);
    expect(draft?.idempotencyKey).not.toBe("     ");
  });

  it("replaces missing or null idempotency key with a new key", () => {
    window.localStorage.setItem(
      DRAFT_STORAGE_KEY,
      JSON.stringify({
        title: "Test Idea",
        body: "Some details",
        projectId: "proj-1",
      })
    );

    const draft = loadDraft();
    expect(draft).not.toBeNull();
    expect(draft?.idempotencyKey).toBeTruthy();
    expect(typeof draft?.idempotencyKey).toBe("string");
    expect(draft?.idempotencyKey.length).toBeGreaterThan(0);
  });

  it("safely handles malformed localStorage JSON without throwing", () => {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, "invalid-json{{");

    expect(() => {
      const draft = loadDraft();
      expect(draft).toBeNull();
    }).not.toThrow();
  });

  it("saveDraft and clearDraftStorage operate predictably", () => {
    const key = createIdempotencyKey();
    saveDraft({
      title: "Saved Idea",
      body: "Saved notes",
      projectId: "proj-2",
      idempotencyKey: key,
    });

    const loaded = loadDraft();
    expect(loaded?.title).toBe("Saved Idea");
    expect(loaded?.idempotencyKey).toBe(key);

    clearDraftStorage();
    expect(loadDraft()).toBeNull();
  });
});
