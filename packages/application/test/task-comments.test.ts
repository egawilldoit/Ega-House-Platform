import assert from "node:assert/strict";
import test from "node:test";

import {
  createTaskComment,
  deleteTaskComment,
  listTaskComments,
  toggleTaskCommentReaction,
  type TaskCommentActor,
  type TaskCommentsRepository,
} from "../src/index";

const OWNER_ACTOR: TaskCommentActor = {
  ownerUserId: "owner-1",
  kind: "owner",
  ref: "owner",
  label: "Owner",
};

const AGENT_ACTOR: TaskCommentActor = {
  ownerUserId: "owner-1",
  kind: "agent",
  ref: "agent:codex",
  label: "Codex",
  tokenId: "token-1",
};

function fakeRepository(overrides: Partial<TaskCommentsRepository> = {}) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const repository: TaskCommentsRepository = {
    async listTaskComments(viewer, taskId) {
      calls.push({ method: "list", args: [viewer, taskId] });
      return { ok: true, value: [] };
    },
    async createTaskComment(actor, input) {
      calls.push({ method: "create", args: [actor, input] });
      return {
        ok: true,
        value: {
          id: "comment-1",
          taskId: input.taskId,
          body: input.body,
          author: { kind: actor.kind, ref: actor.ref, label: actor.label },
          mentions: [],
          reactions: [],
          createdAt: "2026-12-08T00:00:00.000Z",
          updatedAt: "2026-12-08T00:00:00.000Z",
          editedAt: null,
          viewerCanEdit: true,
          viewerCanDelete: true,
        },
      };
    },
    async updateTaskComment() {
      return { ok: false, error: { code: "unknown" } };
    },
    async deleteTaskComment() {
      return { ok: true, value: true };
    },
    async toggleTaskCommentReaction() {
      return { ok: true, value: [] };
    },
    async listTaskCommentMentionCandidates() {
      calls.push({ method: "mention-candidates", args: [] });
      return {
        ok: true,
        value: [
          { kind: "owner", ref: "owner", handle: "owner", label: "You (owner)" },
          { kind: "agent", ref: "agent:codex", handle: "codex", label: "Codex" },
        ],
      };
    },
    ...overrides,
  };
  return { repository, calls };
}

test("owner post derives the stable author and resolves only configured mentions", async () => {
  const { repository, calls } = fakeRepository();
  const result = await createTaskComment(OWNER_ACTOR, repository, {
    taskId: "task-1",
    body: "Hand off to @codex and @ghost",
    clientRequestId: "req-1",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls.map((call) => call.method), ["mention-candidates", "create"]);
  const input = calls[1]?.args[1] as {
    body: string;
    clientRequestId: string;
    mentions: unknown[];
  };
  assert.equal(input.body, "Hand off to @codex and @ghost");
  assert.equal(input.clientRequestId, "req-1");
  assert.deepEqual(input.mentions, [
    { kind: "agent", ref: "agent:codex", handle: "codex", label: "Codex" },
  ]);
});

test("validation happens before persistence", async () => {
  const { repository, calls } = fakeRepository();

  const empty = await createTaskComment(OWNER_ACTOR, repository, {
    taskId: "task-1",
    body: "   ",
    clientRequestId: "req-1",
  });
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.code, "validation");

  const badRequest = await createTaskComment(OWNER_ACTOR, repository, {
    taskId: "task-1",
    body: "note",
    clientRequestId: "bad request",
  });
  assert.equal(badRequest.ok, false);
  if (!badRequest.ok) assert.equal(badRequest.code, "validation");

  assert.equal(calls.some((call) => call.method === "create"), false);
});

test("an agent author requires a credential id and a stable agent ref", async () => {
  const { repository, calls } = fakeRepository();

  const missingToken = await createTaskComment(
    { ...AGENT_ACTOR, tokenId: null },
    repository,
    { taskId: "task-1", body: "note", clientRequestId: "req-1" },
  );
  assert.equal(missingToken.ok, false);

  const badRef = await createTaskComment(
    { ...AGENT_ACTOR, ref: "codex" },
    repository,
    { taskId: "task-1", body: "note", clientRequestId: "req-1" },
  );
  assert.equal(badRef.ok, false);

  assert.equal(calls.some((call) => call.method === "create"), false);
});

test("owner reads use the trusted viewer and repository not-found stays explicit", async () => {
  const { repository, calls } = fakeRepository({
    async listTaskComments() {
      return { ok: false, error: { code: "notFound" } };
    },
  });

  const result = await listTaskComments(
    { ownerUserId: "owner-1", actorRef: "owner" },
    repository,
    "task-1",
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "notFound");
  assert.deepEqual(calls, []);
});

test("reaction toggles enforce the closed emoji set", async () => {
  const { repository, calls } = fakeRepository();

  const bad = await toggleTaskCommentReaction(OWNER_ACTOR, repository, {
    commentId: "comment-1",
    emoji: "💣",
  });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.code, "validation");
  assert.equal(calls.length, 0);

  const good = await toggleTaskCommentReaction(OWNER_ACTOR, repository, {
    commentId: "comment-1",
    emoji: "👍",
  });
  assert.equal(good.ok, true);
});

test("delete requires a comment id and never reports success for a repository failure", async () => {
  const missing = await deleteTaskComment(OWNER_ACTOR, fakeRepository().repository, "");
  assert.equal(missing.ok, false);

  const forbidden = await deleteTaskComment(
    OWNER_ACTOR,
    fakeRepository({
      async deleteTaskComment() {
        return { ok: false, error: { code: "forbidden" } };
      },
    }).repository,
    "comment-1",
  );
  assert.equal(forbidden.ok, false);
  if (!forbidden.ok) assert.equal(forbidden.code, "forbidden");
});
