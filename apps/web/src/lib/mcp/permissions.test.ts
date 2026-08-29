import { describe, expect, it } from "vitest";

import {
  getPermissionsForProfile,
  hasMcpPermission,
  parsePermissionProfile,
} from "@/lib/mcp/permissions";

describe("MCP permission profiles", () => {
  it("maps read_only to project, goal, and task reads only", () => {
    const permissions = getPermissionsForProfile("read_only");

    expect(permissions).toEqual([
      "projects.read",
      "goals.read",
      "tasks.read",
      "today.read",
      "timer.read",
    ]);
    expect(hasMcpPermission(permissions, "tasks.create")).toBe(false);
  });

  it("maps task_manager to read and controlled task write permissions", () => {
    const permissions = getPermissionsForProfile("task_manager");

    expect(hasMcpPermission(permissions, "projects.read")).toBe(true);
    expect(hasMcpPermission(permissions, "tasks.create")).toBe(true);
    expect(hasMcpPermission(permissions, "tasks.update")).toBe(true);
    expect(hasMcpPermission(permissions, "tasks.archive")).toBe(false);
  });

  it("rejects the retired delivery_observer profile with no registered tools", () => {
    expect(() => parsePermissionProfile("delivery_observer")).toThrow(
      "Unsupported MCP permission profile.",
    );
  });

  it("rejects unknown profiles instead of granting a default profile", () => {
    expect(() => parsePermissionProfile("administrator")).toThrow(
      "Unsupported MCP permission profile.",
    );
  });

  it("returns a defensive copy of profile permissions", () => {
    const first = getPermissionsForProfile("read_only");
    first.push("tasks.create");

    expect(getPermissionsForProfile("read_only")).not.toContain("tasks.create");
  });
});
