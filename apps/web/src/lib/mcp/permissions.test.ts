import { describe, expect, it } from "vitest";

import {
  getPermissionsForProfile,
  hasMcpPermission,
  parsePermissionProfile,
  profileHasWritePermission,
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

test("combined workspace+Money profiles are the exact advertised union", () => {
  const workspace = getPermissionsForProfile("workspace_manager");
  const reader = getPermissionsForProfile("workspace_money_reader");
  const writer = getPermissionsForProfile("workspace_money_writer");

  // Reader is read-only everywhere; it never inherits workspace write access.
  expect(new Set(reader)).toEqual(new Set([
    "projects.read",
    "goals.read",
    "tasks.read",
    "today.read",
    "timer.read",
    "personal_ops.read",
  ]));
  expect(profileHasWritePermission("workspace_money_reader")).toBe(false);

  // Writer is exactly workspace_manager plus the Money union.
  expect(new Set(writer)).toEqual(new Set([
    ...workspace,
    "personal_ops.read",
    "personal_ops.write",
  ]));
  expect(new Set(writer).size).toBe(writer.length);
  expect(profileHasWritePermission("workspace_money_writer")).toBe(true);

  // The old workspace profile never gains Money by implication.
  expect(workspace).not.toContain("personal_ops.read");
  expect(workspace).not.toContain("personal_ops.write");
});

test("every write-capable profile is identifiable for writes-disabled consent", () => {
  for (const profile of [
    "task_manager",
    "workspace_manager",
    "personal_operations_writer",
    "workspace_money_writer",
  ] as const) {
    expect(profileHasWritePermission(profile)).toBe(true);
  }
  for (const profile of [
    "read_only",
    "personal_operations",
    "workspace_money_reader",
  ] as const) {
    expect(profileHasWritePermission(profile)).toBe(false);
  }
});
