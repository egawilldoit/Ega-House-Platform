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

test("personal operations profiles are explicit and never inherited by old profiles", () => {
  for (const profile of ["read_only", "task_manager", "workspace_manager"] as const) {
    expect(getPermissionsForProfile(profile)).not.toContain("personal_ops.read");
    expect(getPermissionsForProfile(profile)).not.toContain("personal_ops.write");
  }
  expect(getPermissionsForProfile("personal_operations")).toContain("personal_ops.read");
  expect(getPermissionsForProfile("personal_operations")).not.toContain("personal_ops.write");
  expect(getPermissionsForProfile("personal_operations_writer")).toContain("personal_ops.write");
  expect(parsePermissionProfile("personal_operations_writer")).toBe("personal_operations_writer");
});
