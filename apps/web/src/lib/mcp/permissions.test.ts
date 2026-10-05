import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CURRENT_MCP_PERMISSION_VERSION,
  getPermissionsForProfile,
  hasMcpPermission,
  isKnownPermissionVersion,
  isSupportedPermissionDocument,
  listPermissionDocuments,
  MCP_PERMISSION_PROFILES,
  MCP_PERMISSION_VERSIONS,
  MCP_PERMISSIONS,
  parsePermissionProfile,
  parsePermissionVersion,
  type McpPermission,
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

/**
 * `parsePermissionVersion` is the only thing standing between a number read
 * from a database row and `McpGrantRecord.permissionsVersion`, from where it
 * reaches the MRTR confirmation binding. It had no direct test at all, so the
 * integer bounds and the JSON-type compatibility of that boundary were asserted
 * only indirectly, through a resolver case that passes version 0.
 */
describe("MCP permission versions", () => {
  it("accepts exactly the versions this build can authorise", () => {
    expect(parsePermissionVersion(1)).toBe(1);
    expect(parsePermissionVersion(2)).toBe(2);
  });

  it.each([
    ["zero", 0],
    ["a negative version", -1],
    ["a future version", 3],
    ["a far-future version", 99],
    ["a non-integer", 1.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["a numeric string", "1"],
    ["null", null],
    ["undefined", undefined],
    ["a boolean", true],
    ["an object", { version: 1 }],
  ])("refuses %s rather than coercing it", (_label, value) => {
    expect(isKnownPermissionVersion(value)).toBe(false);
    expect(() => parsePermissionVersion(value)).toThrow(
      "Unsupported MCP permission version.",
    );
  });

  it("keeps version 1 as the issued authority and version 2 defined but not issued", () => {
    // The switch to 2 is the wave that ships the v2 tools, and it must be a
    // new version rather than an edit to v1 - see drizzle/0066 and 0077.
    expect(CURRENT_MCP_PERMISSION_VERSION).toBe(1);
    expect(isSupportedPermissionDocument("workspace_manager", 2)).toBe(true);
    expect(getPermissionsForProfile("read_only", 1)).toEqual(
      getPermissionsForProfile("read_only", CURRENT_MCP_PERMISSION_VERSION),
    );
  });

  it("treats (task_manager, 2) as an invalid pairing rather than an empty document", () => {
    expect(() => getPermissionsForProfile("task_manager", 2)).toThrow(
      "Unsupported MCP permission document.",
    );
  });
});

/**
 * The application is the database's second copy of the same rule, so these are
 * the properties drizzle/0077 enforces in SQL: a (profile, version) pair names
 * exactly one document, that document is duplicate-free, and every entry is in
 * the declared permission universe.
 */
describe("MCP permission documents", () => {
  it("names exactly one duplicate-free, in-universe document per supported pairing", () => {
    const universe = new Set<string>(MCP_PERMISSIONS);
    const seen = new Set<string>();

    for (const { profile, version, permissions } of listPermissionDocuments()) {
      const key = `${profile} v${version}`;
      expect(seen.has(key), `${key} is defined twice`).toBe(false);
      seen.add(key);

      expect(permissions.length, `${key} is empty`).toBeGreaterThan(0);
      expect(
        new Set(permissions).size,
        `${key} repeats a permission`,
      ).toBe(permissions.length);
      for (const permission of permissions) {
        expect(
          universe.has(permission),
          `${key} carries ${permission}, which is outside the declared universe`,
        ).toBe(true);
      }
    }
  });

  it("treats permissions as a set, so declaration order carries no authority", () => {
    const declared = getPermissionsForProfile("workspace_manager", 1);
    const reordered = [...declared].reverse();

    expect(reordered).not.toEqual(declared);
    expect([...reordered].sort()).toEqual([...declared].sort());
    for (const permission of declared as readonly McpPermission[]) {
      expect(hasMcpPermission(reordered, permission)).toBe(true);
    }
  });
});

/**
 * drizzle/0077 is the database's statement of the same rule, so it is read
 * here rather than trusted. Two of its clauses are exactly the two defects it
 * exists to remove, and both are invisible to a set-membership comparison:
 *
 *   - `<@` and `@>` ignore multiplicity, so only the pinned
 *     `jsonb_array_length(permissions) = N` refuses a document that repeats a
 *     permission. A clause that lost its length predicate would still read as
 *     "this profile's document" to a membership check.
 *   - a clause that lost its `permissions_version = N` predicate would accept
 *     a document belonging to a different version, which is the whole meaning of
 *     keying documents on (profile, version).
 *
 * The parser is deliberately strict: it only recognises a clause written in the
 * full keyed form, so a clause that loses any of the four markers stops being
 * counted and the expected clause count fails.
 */
describe("drizzle/0077 keeps (profile, version) bound to one exact document", () => {
  const migration = readFileSync(
    resolve(process.cwd(), "..", "..", "drizzle", "0077_mcp_permission_document_exactness.sql"),
    "utf8",
  );
  // Only the executed statements: the file's own header quotes the constraint in
  // the pre-flight query, and a comment must not be able to satisfy an
  // assertion about what the database enforces.
  const executed = migration.slice(migration.lastIndexOf("--> statement-breakpoint"));

  type Clause = {
    version: number;
    profile: string;
    length: number;
    superset: string[];
    subset: string[];
  };

  const clauses: Clause[] = [
    ...executed.matchAll(
      /\(\s*permissions_version = (\d+)\s*AND permission_profile = '([a-z_]+)'\s*AND jsonb_array_length\(permissions\) = (\d+)\s*AND permissions <@ '(\[[^\]]*\])'::jsonb\s*AND permissions @> '(\[[^\]]*\])'::jsonb\s*\)/g,
    ),
  ].map((match) => ({
    version: Number(match[1]),
    profile: match[2],
    length: Number(match[3]),
    superset: JSON.parse(match[4]) as string[],
    subset: JSON.parse(match[5]) as string[],
  }));

  /** The document the resolver resolves for a supported pairing. */
  const issued = (profile: string, version: number): string[] =>
    getPermissionsForProfile(profile as never, version as never);

  it("pins every document clause to a version, a profile and an exact length", () => {
    // 5 issued documents in the active/pending branch, plus 7 in the terminal
    // branch: each version's own full document plus the 2 legacy short
    // documents 0039/0050 wrote.
    expect(clauses).toHaveLength(12);
    for (const clause of clauses) {
      // Length is what makes containment exact: `subset` may be a strict
      // subset only for the two legacy terminal documents, and then the pinned
      // length is the one that decides which of them the row holds.
      expect(clause.subset.length).toBeLessThanOrEqual(clause.length);
      expect(clause.length).toBeLessThanOrEqual(clause.superset.length);
      expect(new Set(clause.superset).size).toBe(clause.superset.length);
      for (const permission of clause.subset) {
        expect(clause.superset).toContain(permission);
      }
    }
  });

  it("enforces exactly the resolver's documents for every supported pairing", () => {
    const enforced = new Set(
      clauses
        .filter((clause) => clause.length === clause.subset.length)
        .map((clause) => `${clause.profile} v${clause.version}`),
    );
    for (const { profile, version, permissions } of listPermissionDocuments()) {
      const key = `${profile} v${version}`;
      expect(enforced.has(key), `${key} is not enforced exactly by drizzle/0077`).toBe(true);
      const clause = clauses.find(
        (entry) => entry.profile === profile && entry.version === version,
      );
      expect([...clause!.superset].sort()).toEqual([...permissions].sort());
    }
    expect(enforced.size).toBe(
      MCP_PERMISSION_PROFILES.length * MCP_PERMISSION_VERSIONS.length - 1,
    );
  });

  it("refuses a document carrying a permission outside its own profile", () => {
    // The property the length predicate exists for: the database's accepted set
    // is exact, so a same-length substitution cannot satisfy containment.
    const clause = clauses.find(
      (entry) => entry.profile === "read_only" && entry.version === 1,
    )!;
    const substituted = [
      ...clause.superset.slice(0, -1),
      "friction.read",
    ];
    expect(substituted).toHaveLength(clause.length);
    expect(clause.subset.every((permission) => substituted.includes(permission))).toBe(false);
  });

  it("keeps the retired delivery_observer document pinned but version-agnostic", () => {
    // 0050 already pins this profile to one exact document on terminal rows
    // only, and it is not an application profile, so the number on such a row
    // names nothing. Asserted so a future edit cannot quietly widen it.
    expect([
      ...executed.matchAll(/permission_profile = 'delivery_observer'/g),
    ]).toHaveLength(1);
    expect(executed).toContain(
      `permissions = '["delivery_runs.read","delivery_events.read","delivery_artifacts.read"]'::jsonb`,
    );
  });
});
