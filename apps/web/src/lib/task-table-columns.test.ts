import assert from "node:assert/strict";
import test from "node:test";

import {
  TASK_TABLE_COLUMN_MAX_WIDTH,
  TASK_TABLE_COLUMN_MIN_WIDTH,
  normalizeTaskTableColumns,
} from "@ega/contracts/common/task-list";
import {
  buildTaskTableColumnsUrl,
  parseTaskTableColumns,
  serializeTaskTableColumns,
  setTaskTableUrlParam,
} from "./task-table-columns";

function visibleIds(columns: ReturnType<typeof parseTaskTableColumns>) {
  return columns.filter((column) => column.visible).map((column) => column.id);
}

test("missing URL state resolves to the pre-EGA-792 inventory columns", () => {
  const columns = parseTaskTableColumns({});

  assert.deepEqual(visibleIds(columns), ["task", "priority", "due", "status"]);
  assert.deepEqual(
    columns.map((column) => `${column.id}:${column.width}:${column.visible}`),
    [
      "task:360:true",
      "priority:112:true",
      "due:152:true",
      "status:144:true",
      "project:160:false",
      "estimate:112:false",
    ],
  );
  assert.deepEqual(serializeTaskTableColumns(columns), { cols: null, widths: null });
});

test("parses visible order and width overrides from the compact URL", () => {
  const columns = parseTaskTableColumns({
    cols: "task,project,due,priority",
    widths: "task:420,due:96",
  });

  assert.deepEqual(visibleIds(columns), ["task", "project", "due", "priority"]);
  assert.equal(columns.find((column) => column.id === "task")?.width, 420);
  assert.equal(columns.find((column) => column.id === "due")?.width, 96);
  assert.equal(columns.find((column) => column.id === "status")?.visible, false);
});

test("forces task first/visible and drops unknown or duplicate ids", () => {
  const columns = parseTaskTableColumns({
    cols: "priority,priority,unknown,task",
    widths: "unknown:200,task:10",
  });

  assert.deepEqual(visibleIds(columns), ["task", "priority"]);
  assert.equal(columns[0]?.id, "task");
  assert.equal(columns[0]?.width, TASK_TABLE_COLUMN_MIN_WIDTH);
});

test("clamps untrusted widths to the validated bounds", () => {
  const columns = parseTaskTableColumns({
    cols: "task,priority",
    widths: `task:${TASK_TABLE_COLUMN_MAX_WIDTH + 1000},priority:1`,
  });

  assert.equal(columns.find((column) => column.id === "task")?.width, TASK_TABLE_COLUMN_MAX_WIDTH);
  assert.equal(columns.find((column) => column.id === "priority")?.width, TASK_TABLE_COLUMN_MIN_WIDTH);
});

test("serializes only deviations and round-trips them", () => {
  const columns = parseTaskTableColumns({
    cols: "task,project,status",
    widths: "task:420,project:240",
  });
  const serialized = serializeTaskTableColumns(columns);

  assert.equal(serialized.cols, "task,project,status");
  assert.equal(serialized.widths, "task:420,project:240");
  assert.deepEqual(
    parseTaskTableColumns(serialized).map((column) => [
      column.id,
      column.width,
      column.visible,
    ]),
    columns.map((column) => [column.id, column.width, column.visible]),
  );
});

test("normalizes a saved-view column array and supplies defaults for added columns", () => {
  const columns = normalizeTaskTableColumns([
    { id: "task", width: 9999, visible: false },
    { id: "priority", width: 120, visible: true },
    { id: "priority", width: 200, visible: false },
  ]);

  assert.equal(columns[0]?.id, "task");
  assert.equal(columns[0]?.visible, true);
  assert.equal(columns[0]?.width, TASK_TABLE_COLUMN_MAX_WIDTH);
  assert.deepEqual(visibleIds(columns), ["task", "priority", "due", "status"]);
  assert.deepEqual(
    columns.map((column) => column.id),
    ["task", "priority", "due", "status", "project", "estimate"],
  );
});

test("updates only the column parameters in an existing view URL", () => {
  const url = buildTaskTableColumnsUrl(
    "/tasks?status=todo&sort=priority_desc&density=compact",
    parseTaskTableColumns({ cols: "task,status", widths: "status:200" }),
  );
  const parsed = new URL(url, "http://ega.local");

  assert.equal(parsed.searchParams.get("status"), "todo");
  assert.equal(parsed.searchParams.get("sort"), "priority_desc");
  assert.equal(parsed.searchParams.get("density"), "compact");
  assert.equal(parsed.searchParams.get("cols"), "task,status");
  assert.equal(parsed.searchParams.get("widths"), "status:200");

  const reset = buildTaskTableColumnsUrl(url, parseTaskTableColumns({}));
  const resetParams = new URL(reset, "http://ega.local").searchParams;
  assert.equal(resetParams.get("cols"), null);
  assert.equal(resetParams.get("widths"), null);
  assert.equal(setTaskTableUrlParam("/tasks", "sort", "title_asc"), "/tasks?sort=title_asc");
});
