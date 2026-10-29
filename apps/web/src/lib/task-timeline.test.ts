import assert from "node:assert/strict";
import test from "node:test";

import {
  TIMELINE_MAX_RANGE_DAYS,
  buildTimelineModel,
  dayDistance,
  resolveTimelineRange,
} from "./task-timeline";

test("timeline range is a bounded two-week-back window by default", () => {
  const range = resolveTimelineRange("2026-05-20");
  assert.equal(range.start, "2026-05-06");
  assert.equal(range.end, "2026-06-30");
  assert.equal(range.days.length, 56);
  assert.equal(range.days[0], "2026-05-06");
  assert.equal(range.days.at(-1), "2026-06-30");
});

test("invalid or unreasonably distant anchors fall back to the canonical window", () => {
  assert.equal(resolveTimelineRange("2026-05-20", "2026-02-30").start, "2026-05-06");
  assert.equal(resolveTimelineRange("2026-05-20", "2030-01-01").start, "2026-05-06");
  assert.equal(resolveTimelineRange("2026-05-20", "2026-06-01").start, "2026-06-01");
});

test("requested range length is clamped to the hard ceiling", () => {
  const range = resolveTimelineRange("2026-05-20", "2026-05-01", 10_000);
  assert.equal(range.days.length, TIMELINE_MAX_RANGE_DAYS);
});

test("same-day tasks render as a real one-day bar", () => {
  const range = resolveTimelineRange("2026-05-20");
  const model = buildTimelineModel(
    [{ id: "a", title: "Same day", status: "todo", start_date: "2026-05-20", due_date: "2026-05-20" }],
    [],
    range,
  );
  assert.equal(model.scheduledRows.length, 1);
  const bar = model.scheduledRows[0]?.bar;
  assert.ok(bar);
  assert.equal(bar.startOffset, bar.endOffset);
  assert.equal(bar.spanDays, 1);
  assert.equal(bar.clippedStart, false);
  assert.equal(bar.clippedEnd, false);
});

test("missing dates stay unscheduled instead of inventing a bar", () => {
  const range = resolveTimelineRange("2026-05-20");
  const model = buildTimelineModel(
    [
      { id: "a", title: "No start", status: "todo", start_date: null, due_date: "2026-05-21" },
      { id: "b", title: "No due", status: "todo", start_date: "2026-05-21", due_date: null },
      { id: "c", title: "Inverted", status: "todo", start_date: "2026-05-22", due_date: "2026-05-21" },
    ],
    [],
    range,
  );
  assert.equal(model.scheduledRows.length, 0);
  assert.deepEqual(
    model.unscheduledRows.map((row) => row.task.id).sort(),
    ["a", "b", "c"],
  );
});

test("bars that span into the window clamp visibly and report clipping", () => {
  const range = resolveTimelineRange("2026-05-20");
  const model = buildTimelineModel(
    [
      {
        id: "span",
        title: "Long task",
        status: "in_progress",
        start_date: "2026-04-01",
        due_date: "2026-07-15",
      },
    ],
    [],
    range,
  );
  const bar = model.scheduledRows[0]?.bar;
  assert.ok(bar);
  assert.equal(bar.startOffset, 0);
  assert.equal(bar.endOffset, range.days.length - 1);
  assert.equal(bar.clippedStart, true);
  assert.equal(bar.clippedEnd, true);
});

test("arrows render only when both endpoints are visible; other edges become hidden counts", () => {
  const range = resolveTimelineRange("2026-05-20");
  const model = buildTimelineModel(
    [
      { id: "a", title: "A", status: "todo", start_date: "2026-05-20", due_date: "2026-05-21" },
      { id: "b", title: "B", status: "todo", start_date: "2026-05-22", due_date: "2026-05-24" },
      { id: "c", title: "C", status: "todo", start_date: "2026-05-25", due_date: "2026-05-26" },
    ],
    [
      { taskId: "b", blockedByTaskId: "a" },
      { taskId: "c", blockedByTaskId: "outside-window" },
    ],
    range,
  );

  assert.equal(model.arrows.length, 1);
  assert.deepEqual(model.arrows[0], {
    fromTaskId: "a",
    toTaskId: "b",
    fromRow: 0,
    toRow: 1,
    fromOffset: model.scheduledRows[0]!.bar!.endOffset,
    toOffset: model.scheduledRows[1]!.bar!.startOffset,
  });
  assert.equal(model.hiddenDependencyCountByTask.c, 1);
  assert.ok(model.dependencyLines.some((line) => line.includes("B is blocked by A")));
  assert.ok(model.dependencyLines.some((line) => line.includes("outside this view")));
});

test("dayDistance is inclusive date arithmetic in UTC", () => {
  assert.equal(dayDistance("2026-05-20", "2026-05-20"), 0);
  assert.equal(dayDistance("2026-05-20", "2026-05-21"), 1);
  assert.equal(dayDistance("2026-05-20", "2026-06-20"), 31);
  assert.equal(Number.isFinite(dayDistance("not-a-date", "2026-05-20")), false);
});
