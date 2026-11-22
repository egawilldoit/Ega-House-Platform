// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  loadDraft,
  saveDraft,
  clearDraftStorage,
  createIdempotencyKey,
  inboxCaptureStorageKey,
} from "./inbox-capture-sheet";
import { captureKeyContent } from "@/lib/inbox-capture/draft-storage";

const OWNER = "owner-123";

describe("Backlog draft idempotency key normalization", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("preserves a valid persisted idempotency key", () => {
    const storageKey = inboxCaptureStorageKey(OWNER);
    window.localStorage.setItem(
      storageKey!,
      JSON.stringify({
        title: "Test Idea",
        body: "Some details",
        projectId: "proj-1",
        idempotencyKey: "custom-key-123",
      }),
    );

    const draft = loadDraft(OWNER);
    expect(draft).not.toBeNull();
    expect(draft?.idempotencyKey).toBe("custom-key-123");
  });

  it("trims surrounding whitespace from a persisted idempotency key", () => {
    window.localStorage.setItem(
      inboxCaptureStorageKey(OWNER)!,
      JSON.stringify({
        title: "Test Idea",
        body: "Some details",
        projectId: "proj-1",
        idempotencyKey: "   padded-key-456   ",
      }),
    );

    const draft = loadDraft(OWNER);
    expect(draft).not.toBeNull();
    expect(draft?.idempotencyKey).toBe("padded-key-456");
  });

  it("replaces whitespace-only key with a newly generated valid key", () => {
    window.localStorage.setItem(
      inboxCaptureStorageKey(OWNER)!,
      JSON.stringify({
        title: "Test Idea",
        body: "Some details",
        projectId: "proj-1",
        idempotencyKey: "     ",
      }),
    );

    const draft = loadDraft(OWNER);
    expect(draft).not.toBeNull();
    expect(draft?.idempotencyKey).toBeTruthy();
    expect(draft?.idempotencyKey.trim().length).toBeGreaterThan(0);
    expect(draft?.idempotencyKey).not.toBe("     ");
  });

  it("replaces missing or null idempotency key with a new key", () => {
    window.localStorage.setItem(
      inboxCaptureStorageKey(OWNER)!,
      JSON.stringify({
        title: "Test Idea",
        body: "Some details",
        projectId: "proj-1",
      }),
    );

    const draft = loadDraft(OWNER);
    expect(draft).not.toBeNull();
    expect(draft?.idempotencyKey).toBeTruthy();
    expect(typeof draft?.idempotencyKey).toBe("string");
    expect(draft?.idempotencyKey.length).toBeGreaterThan(0);
  });

  it("safely handles malformed localStorage JSON without throwing", () => {
    window.localStorage.setItem(inboxCaptureStorageKey(OWNER)!, "invalid-json{{");

    expect(() => {
      const draft = loadDraft(OWNER);
      expect(draft).toBeNull();
    }).not.toThrow();
  });

  it("saveDraft and clearDraftStorage operate predictably", () => {
    const key = createIdempotencyKey();
    const draft = {
      title: "Saved Idea",
      body: "Saved notes",
      projectId: "proj-2",
      idempotencyKey: key,
      keyContent: captureKeyContent({
        title: "Saved Idea",
        body: "Saved notes",
        projectId: "proj-2",
      }),
    };
    saveDraft(draft, OWNER);

    const loaded = loadDraft(OWNER);
    expect(loaded?.title).toBe("Saved Idea");
    expect(loaded?.idempotencyKey).toBe(key);

    clearDraftStorage(OWNER);
    expect(loadDraft(OWNER)).toBeNull();
  });

  it("isolates drafts by verified owner instead of using one global key", () => {
    saveDraft(
      {
        title: "Owner A draft",
        body: "",
        projectId: "",
        idempotencyKey: createIdempotencyKey(),
        keyContent: captureKeyContent({
          title: "Owner A draft",
          body: "",
          projectId: "",
        }),
      },
      "owner-a",
    );

    expect(loadDraft("owner-b")).toBeNull();
    expect(loadDraft("owner-a")?.title).toBe("Owner A draft");
    // A signed-out surface never reads or writes storage.
    expect(loadDraft(null)).toBeNull();
  });
});
