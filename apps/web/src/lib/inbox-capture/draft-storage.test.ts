// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import {
  captureKeyContent,
  clearInboxCaptureDraftIfUnchanged,
  createEmptyCaptureDraft,
  loadInboxCaptureDraft,
  saveInboxCaptureDraft,
} from "./draft-storage";

const OWNER_A = "owner-a";
const OWNER_B = "owner-b";

describe("inbox capture draft recovery", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("recovers an unsaved draft for the same verified owner", () => {
    const draft = {
      ...createEmptyCaptureDraft(),
      title: "Follow up on onboarding",
      body: "Ask about the drop-off",
      projectId: "project-1",
    };
    draft.keyContent = captureKeyContent(draft);
    saveInboxCaptureDraft(OWNER_A, draft);

    const recovered = loadInboxCaptureDraft(OWNER_A);
    expect(recovered).toMatchObject({
      title: "Follow up on onboarding",
      body: "Ask about the drop-off",
      projectId: "project-1",
      idempotencyKey: draft.idempotencyKey,
      keyContent: draft.keyContent,
    });
  });

  it("never leaks another account's draft", () => {
    saveInboxCaptureDraft(OWNER_A, {
      ...createEmptyCaptureDraft(),
      title: "Owner A secret",
    });

    expect(loadInboxCaptureDraft(OWNER_B)).toBeNull();
    expect(loadInboxCaptureDraft(null)).toBeNull();
  });

  it("clears only the acknowledged draft, not newer text from another tab", () => {
    const acknowledged = { ...createEmptyCaptureDraft(), title: "First" };
    acknowledged.keyContent = captureKeyContent(acknowledged);
    saveInboxCaptureDraft(OWNER_A, acknowledged);

    const newer = {
      ...createEmptyCaptureDraft(),
      title: "Second",
    };
    newer.keyContent = captureKeyContent(newer);
    saveInboxCaptureDraft(OWNER_A, newer);

    clearInboxCaptureDraftIfUnchanged(OWNER_A, acknowledged);

    expect(loadInboxCaptureDraft(OWNER_A)?.title).toBe("Second");
  });

  it("rotates the idempotency key input when the payload changes", () => {
    const first = captureKeyContent({ title: "A", body: "", projectId: "" });
    const second = captureKeyContent({ title: "A", body: "note", projectId: "" });
    expect(first).not.toBe(second);
  });
});
