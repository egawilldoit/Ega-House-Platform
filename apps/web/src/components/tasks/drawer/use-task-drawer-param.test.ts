import { describe, expect, it } from "vitest";

import {
  TASK_DRAWER_MODE_PARAM,
  TASK_DRAWER_PARAM,
  buildTaskDrawerHref,
  readTaskDrawerParam,
} from "./use-task-drawer-param";

describe("readTaskDrawerParam", () => {
  it("returns no task and the panel mode when the parameters are absent", () => {
    expect(readTaskDrawerParam(new URLSearchParams("view=active&layout=board"))).toEqual({
      taskId: null,
      mode: "panel",
    });
  });

  it("reads the task id and the full mode", () => {
    const params = new URLSearchParams("task=abc-123&taskMode=full");
    expect(readTaskDrawerParam(params)).toEqual({ taskId: "abc-123", mode: "full" });
  });

  it("treats an unknown mode as the panel presentation", () => {
    const params = new URLSearchParams("task=abc&taskMode=sideways");
    expect(readTaskDrawerParam(params).mode).toBe("panel");
  });

  it("trims whitespace and ignores a blank id", () => {
    expect(readTaskDrawerParam(new URLSearchParams("task=%20%20")).taskId).toBeNull();
    expect(readTaskDrawerParam(new URLSearchParams("task=%20abc%20")).taskId).toBe("abc");
  });
});

describe("buildTaskDrawerHref", () => {
  const base = new URLSearchParams("view=active&layout=board&sort=due&density=compact&project=p1");

  it("opens a task without disturbing the list state", () => {
    const href = buildTaskDrawerHref("/tasks", base, { taskId: "t1" });
    const params = new URLSearchParams(href.split("?")[1]);
    expect(href.startsWith("/tasks?")).toBe(true);
    expect(params.get("task")).toBe("t1");
    expect(params.get("view")).toBe("active");
    expect(params.get("layout")).toBe("board");
    expect(params.get("sort")).toBe("due");
    expect(params.get("density")).toBe("compact");
    expect(params.get("project")).toBe("p1");
    expect(params.has("taskMode")).toBe(false);
  });

  it("adds the full mode only when requested", () => {
    const panel = buildTaskDrawerHref("/tasks", base, { taskId: "t1", mode: "panel" });
    const full = buildTaskDrawerHref("/tasks", base, { taskId: "t1", mode: "full" });
    expect(new URLSearchParams(panel.split("?")[1]).has("taskMode")).toBe(false);
    expect(new URLSearchParams(full.split("?")[1]).get("taskMode")).toBe("full");
  });

  it("switching back to the panel mode drops a previous full marker", () => {
    const withFull = new URLSearchParams(`${base.toString()}&task=t1&taskMode=full`);
    const href = buildTaskDrawerHref("/tasks", withFull, { taskId: "t1", mode: "panel" });
    expect(new URLSearchParams(href.split("?")[1]).has("taskMode")).toBe(false);
    expect(new URLSearchParams(href.split("?")[1]).get("task")).toBe("t1");
  });

  it("removes only the drawer parameters on close", () => {
    const open = new URLSearchParams(`${base.toString()}&task=t1&taskMode=full`);
    const href = buildTaskDrawerHref("/tasks", open, { taskId: null });
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.has("task")).toBe(false);
    expect(params.has("taskMode")).toBe(false);
    expect(params.get("view")).toBe("active");
    expect(params.get("layout")).toBe("board");
  });

  it("returns the bare path when nothing else is left", () => {
    const onlyTask = new URLSearchParams("task=t1");
    expect(buildTaskDrawerHref("/tasks", onlyTask, { taskId: null })).toBe("/tasks");
  });

  it("keeps the existing view parameter distinct from the drawer mode", () => {
    const params = new URLSearchParams("view=archived");
    const href = buildTaskDrawerHref("/tasks", params, { taskId: "t1", mode: "full" });
    const parsed = new URLSearchParams(href.split("?")[1]);
    expect(parsed.get("view")).toBe("archived");
    expect(parsed.get("taskMode")).toBe("full");
  });

  it("exports stable parameter names", () => {
    expect(TASK_DRAWER_PARAM).toBe("task");
    expect(TASK_DRAWER_MODE_PARAM).toBe("taskMode");
  });
});
