import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

const resolveAgentAuth = vi.hoisted(() => vi.fn());

vi.mock("@/lib/services/agent-token-service", () => ({
  resolveAgentAuth,
}));

const service = vi.hoisted(() => ({
  listAgentTaskComments: vi.fn(),
  createAgentTaskComment: vi.fn(),
  updateAgentTaskComment: vi.fn(),
  deleteAgentTaskComment: vi.fn(),
  toggleAgentTaskCommentReaction: vi.fn(),
}));

vi.mock("@/lib/services/agent-comment-service", () => service);

import { createCommentHandlers } from "./agent-comment-handlers";

const SCOPES = {
  tasks: { read: true, comment: true },
};

const CONTEXT = {
  tokenId: "token-1",
  tokenName: "Codex",
  ownerUserId: "owner-1",
  scopes: SCOPES,
};

const repo = {
  findByPrefix: vi.fn(),
  insertToken: vi.fn(),
  updateLastUsedAt: vi.fn(),
  revokeToken: vi.fn(),
};

function request(body?: unknown, method = "GET") {
  return new Request("https://ega.test/api/agent/tasks/task-1/comments", {
    method,
    headers: { authorization: "Bearer ega_agent_test" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  resolveAgentAuth.mockReset();
  resolveAgentAuth.mockResolvedValue({ ok: true, context: CONTEXT });
  for (const fn of Object.values(service)) fn.mockReset();
  service.listAgentTaskComments.mockResolvedValue({ ok: true, data: [] });
});

test("comment endpoints require the tasks:comment scope", async () => {
  resolveAgentAuth.mockResolvedValue({
    ok: true,
    context: { ...CONTEXT, scopes: { tasks: { read: true } } },
  });
  const handlers = createCommentHandlers(repo);

  const createResponse = await handlers.POST_COMMENTS(
    request({ body: "hello", clientRequestId: "req-1" }, "POST"),
    "task-1",
  );
  assert.equal(createResponse.status, 403);
  assert.equal(service.createAgentTaskComment.mock.calls.length, 0);

  const readResponse = await handlers.GET_COMMENTS(request(), "task-1");
  assert.equal(readResponse.status, 200);
});

test("posting derives the author from the token and returns 201", async () => {
  service.createAgentTaskComment.mockResolvedValue({
    ok: true,
    data: {
      id: "comment-1",
      taskId: "task-1",
      body: "hello",
      author: { kind: "agent", ref: "agent:codex", label: "Codex" },
      mentions: [],
      reactions: [],
      createdAt: "2026-10-28T00:00:00.000Z",
      updatedAt: "2026-10-28T00:00:00.000Z",
      editedAt: null,
      viewerCanEdit: true,
      viewerCanDelete: true,
    },
  });
  const handlers = createCommentHandlers(repo);

  const response = await handlers.POST_COMMENTS(
    request({ body: "hello", clientRequestId: "req-1" }, "POST"),
    "task-1",
  );
  assert.equal(response.status, 201);
  assert.deepEqual(service.createAgentTaskComment.mock.calls[0], [
    { ownerUserId: "owner-1", tokenId: "token-1", tokenName: "Codex" },
    { taskId: "task-1", body: "hello", clientRequestId: "req-1" },
  ]);
});

test("caller-supplied author, owner and mention fields are rejected", async () => {
  const handlers = createCommentHandlers(repo);

  for (const field of ["authorRef", "author_token_id", "ownerUserId", "actorRef"]) {
    const response = await handlers.POST_COMMENTS(
      request({ body: "hello", clientRequestId: "req-1", [field]: "spoof" }, "POST"),
      "task-1",
    );
    assert.equal(response.status, 400, field);
  }
  assert.equal(service.createAgentTaskComment.mock.calls.length, 0);
});

test("a retry identity is required for posting", async () => {
  const handlers = createCommentHandlers(repo);
  const response = await handlers.POST_COMMENTS(
    request({ body: "hello" }, "POST"),
    "task-1",
  );
  assert.equal(response.status, 400);
  assert.equal(service.createAgentTaskComment.mock.calls.length, 0);
});

test("source and sourceId form a retry identity", async () => {
  service.createAgentTaskComment.mockResolvedValue({
    ok: false,
    errorMessage: "Task was not found.",
    code: "notFound",
  });
  const handlers = createCommentHandlers(repo);
  const response = await handlers.POST_COMMENTS(
    request({ body: "hello", source: "linear", sourceId: "EGA-783" }, "POST"),
    "task-1",
  );
  assert.equal(response.status, 404);
  assert.equal(
    service.createAgentTaskComment.mock.calls[0]?.[1].clientRequestId,
    "linear:EGA-783",
  );
});

test("cross-agent edit and unsupported reaction fail closed", async () => {
  service.updateAgentTaskComment.mockResolvedValue({
    ok: false,
    errorMessage: "Comment was not found or is no longer available.",
    code: "notFound",
  });
  service.toggleAgentTaskCommentReaction.mockResolvedValue({
    ok: false,
    errorMessage: "That reaction is not supported.",
    code: "validation",
  });
  const handlers = createCommentHandlers(repo);

  const patch = await handlers.PATCH_COMMENT(
    request({ body: "edited" }, "PATCH"),
    "task-1",
    "comment-1",
  );
  assert.equal(patch.status, 404);

  const reaction = await handlers.POST_REACTION(
    request({ emoji: "💣" }, "POST"),
    "task-1",
    "comment-1",
  );
  assert.equal(reaction.status, 422);
});

test("unauthenticated requests never reach the service", async () => {
  resolveAgentAuth.mockResolvedValue({
    ok: false,
    response: {
      ok: false,
      error: { code: "UNAUTHENTICATED", message: "Missing or invalid agent token." },
    },
    status: 401,
  });
  const handlers = createCommentHandlers(repo);
  const response = await handlers.GET_COMMENTS(request(), "task-1");
  assert.equal(response.status, 401);
  assert.equal(service.listAgentTaskComments.mock.calls.length, 0);
});
