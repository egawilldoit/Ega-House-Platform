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

  it("maps delivery_observer to delivery reads without task writes", () => {
    const permissions = getPermissionsForProfile("delivery_observer");

    expect(permissions).toEqual([
      "delivery_runs.read",
      "delivery_events.read",
      "delivery_artifacts.read",
    ]);
    expect(hasMcpPermission(permissions, "tasks.update")).toBe(false);
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
