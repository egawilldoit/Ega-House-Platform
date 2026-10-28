import assert from "node:assert/strict";
import test from "node:test";

import {
  TASK_COMMENT_BODY_MAX,
  TASK_COMMENT_REACTION_EMOJIS,
  agentMentionRef,
  extractTaskCommentMentionHandles,
  isTaskCommentMentionRef,
  isTaskCommentReactionEmoji,
  normalizeTaskCommentBody,
  normalizeTaskCommentRequestId,
  ownerTaskCommentActor,
  resolveTaskCommentMentions,
  taskCommentActorSlug,
} from "../src/index";

test("comment bodies are trimmed, bounded and CRLF-normalised", () => {
  assert.deepEqual(normalizeTaskCommentBody("  hello\r\nworld  "), {
    ok: true,
    value: "hello\nworld",
  });
  assert.equal(normalizeTaskCommentBody("   ").ok, false);
  assert.equal(
    normalizeTaskCommentBody("x".repeat(TASK_COMMENT_BODY_MAX + 1)).ok,
    false,
  );
  assert.equal(normalizeTaskCommentBody("ok\u0000no").ok, false);
});

test("request ids require a bounded, safe idempotency key", () => {
  assert.deepEqual(normalizeTaskCommentRequestId(" req-1 "), {
    ok: true,
    value: "req-1",
  });
  assert.equal(normalizeTaskCommentRequestId("").ok, false);
  assert.equal(normalizeTaskCommentRequestId("bad id with spaces").ok, false);
  assert.equal(normalizeTaskCommentRequestId("a".repeat(129)).ok, false);
});

test("agent identity is a stable slug separate from a token id", () => {
  assert.equal(taskCommentActorSlug("OpenCode"), "opencode");
  assert.equal(taskCommentActorSlug(" T3 Runner "), "t3-runner");
  assert.equal(taskCommentActorSlug("***"), "");
  assert.equal(agentMentionRef("Codex"), "agent:codex");
  assert.equal(isTaskCommentMentionRef("owner"), true);
  assert.equal(isTaskCommentMentionRef("agent:codex"), true);
  assert.equal(isTaskCommentMentionRef("agent:"), false);
  assert.equal(isTaskCommentMentionRef("codex"), false);
});

test("typed mentions ignore email-like tokens and unknown actors", () => {
  assert.deepEqual(
    extractTaskCommentMentionHandles(
      "@codex please ask @owner, mail a@codex.test and @Codex again",
    ),
    ["codex", "owner"],
  );

  const resolved = resolveTaskCommentMentions("@codex @ghost @codex", [
    { kind: "owner", ref: "owner", handle: "owner", label: "You (owner)" },
    { kind: "agent", ref: "agent:codex", handle: "codex", label: "Codex" },
    { kind: "agent", ref: "agent:bad", handle: "bad", label: "Bad" },
  ]);

  assert.deepEqual(resolved, [
    { kind: "agent", ref: "agent:codex", handle: "codex", label: "Codex" },
  ]);
  assert.deepEqual(resolveTaskCommentMentions("@ghost", []), []);
});

test("mentions are capped and the reaction set is closed", () => {
  const candidates = Array.from({ length: 25 }, (_, index) => ({
    kind: "agent" as const,
    ref: `agent:a${index}`,
    handle: `a${index}`,
    label: `Agent ${index}`,
  }));
  const body = candidates.map((candidate) => `@${candidate.handle}`).join(" ");
  assert.equal(resolveTaskCommentMentions(body, candidates).length, 20);

  for (const emoji of TASK_COMMENT_REACTION_EMOJIS) {
    assert.equal(isTaskCommentReactionEmoji(emoji), true);
  }
  assert.equal(isTaskCommentReactionEmoji("💣"), false);
  assert.equal(isTaskCommentReactionEmoji("text"), false);
});

test("owner actor is always the stable owner ref", () => {
  assert.deepEqual(ownerTaskCommentActor("owner-1"), {
    ownerUserId: "owner-1",
    kind: "owner",
    ref: "owner",
    label: "Owner",
  });
});
