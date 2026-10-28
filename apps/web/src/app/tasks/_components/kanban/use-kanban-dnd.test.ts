// @vitest-environment jsdom
import assert from "node:assert/strict";
import test from "node:test";

import type { TaskRecord } from "@/lib/services/task-service";

import {
  applyKanbanOptimisticMove,
  buildKanbanMoveRequest,
  kanbanColumnEndId,
  resolveKanbanDropTarget,
  type KanbanTasksByStatus,
} from "./use-kanban-dnd";

function task(id: string, status: string, boardRank: string | null, extra: Partial<TaskRecord> = {}) {
  return {
    id,
    status,
    title: `Task ${id}`,
    priority: "medium",
    board_rank: boardRank,
    updated_at: "2026-10-28T10:00:00.000Z",
    blocked_reason: null,
    archived_at: null,
    ...extra,
  } as unknown as TaskRecord;
}

function buildBoard(): KanbanTasksByStatus {
  return {
    todo: [task("t1", "todo", "A"), task("t2", "todo", "B"), task("t3", "todo", "C")],
    in_progress: [task("p1", "in_progress", "A"), task("p2", "in_progress", "B")],
    review: [],
    blocked: [],
    done: [],
  };
}

test("drop target resolves before/after a card and the column end", () => {
  const board = buildBoard();
  assert.deepEqual(
    resolveKanbanDropTarget(board, "t1", "t3", false),
    { status: "todo", index: 1 },
  );
  assert.deepEqual(
    resolveKanbanDropTarget(board, "t1", "t3", true),
    { status: "todo", index: 2 },
  );
  assert.deepEqual(
    resolveKanbanDropTarget(board, "t1", kanbanColumnEndId("in_progress"), false),
    { status: "in_progress", index: 2 },
  );
  assert.equal(resolveKanbanDropTarget(board, "t1", "missing", false), null);
});

test("a move request carries visible neighbours, ranks and the card version", () => {
  const board = buildBoard();
  const request = buildKanbanMoveRequest(board, "t1", { status: "in_progress", index: 1 });
  assert.deepEqual(request, {
    taskId: "t1",
    toStatus: "in_progress",
    beforeTaskId: "p1",
    afterTaskId: "p2",
    expectedBeforeRank: "A",
    expectedAfterRank: "B",
    expectedUpdatedAt: "2026-10-28T10:00:00.000Z",
  });
});

test("dropping a card back onto the same neighbours is not a write", () => {
  const board = buildBoard();
  // Dropping on the card itself has no target; dropping at the same index
  // resolves to the same neighbours and is therefore a no-op.
  assert.equal(resolveKanbanDropTarget(board, "t2", "t2", false), null);
  assert.equal(
    buildKanbanMoveRequest(board, "t2", { status: "todo", index: 1 }),
    null,
  );
});

test("optimistic move removes from the source column and inserts between neighbours", () => {
  const board = buildBoard();
  const next = applyKanbanOptimisticMove(board, {
    taskId: "t3",
    toStatus: "in_progress",
    beforeTaskId: "p1",
    afterTaskId: "p2",
  });

  assert.deepEqual(next.todo.map((entry) => entry.id), ["t1", "t2"]);
  assert.deepEqual(next.in_progress.map((entry) => entry.id), ["p1", "t3", "p2"]);
  assert.equal(next.in_progress[1]?.status, "in_progress");
  // The input is never mutated.
  assert.deepEqual(board.todo.map((entry) => entry.id), ["t1", "t2", "t3"]);
});

test("optimistic move to an empty column appends", () => {
  const board = buildBoard();
  const next = applyKanbanOptimisticMove(board, {
    taskId: "t1",
    toStatus: "review",
    beforeTaskId: null,
    afterTaskId: null,
  });
  assert.deepEqual(next.review.map((entry) => entry.id), ["t1"]);
  assert.deepEqual(next.todo.map((entry) => entry.id), ["t2", "t3"]);
});
