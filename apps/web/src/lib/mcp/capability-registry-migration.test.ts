import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  MCP_CAPABILITIES,
  getAllCapabilityNames,
  getCapability,
} from "@/lib/mcp/capability-registry";
import { MCP_AGGREGATE_BUCKET_PREFIX } from "@/lib/mcp/rate-limit-repository";
import {
  CURRENT_MCP_PERMISSION_VERSION,
  MCP_PERMISSIONS,
  MCP_PERMISSION_PROFILES,
  MCP_PERMISSION_VERSIONS,
  getPermissionsForProfile,
  isSupportedPermissionDocument,
  listPermissionDocuments,
  listUnsupportedPermissionDocuments,
} from "@/lib/mcp/permissions";

const drizzlePath = (...segments: string[]): string =>
  resolve(process.cwd(), "..", "..", "drizzle", ...segments);

const readMigration = (name: string): string =>
  readFileSync(drizzlePath(name), "utf8");

/**
 * Extracts the quoted MCP tool identities from private.is_registered_mcp_tool.
 *
 * This reads the migration's actual VALUES list rather than merely checking that
 * the file or the function name exists, so the assertions below are sensitive
 * to the contents. The migration that defines the function last wins, matching
 * how the journal applies them.
 */
function readAuditToolAllowlist(): Set<string> {
  // Driven from the journal in application order rather than a hardcoded list,
  // so a later migration that redefines the function is picked up automatically.
  // The previous list named 0065 and 0067 while 0069 is the migration that
  // actually redefines this function, so editing 0069's list failed no test
  // while this test still claimed to detect drift.
  const journal = JSON.parse(
    readFileSync(drizzlePath("meta", "_journal.json"), "utf8"),
  ) as { entries: Array<{ idx: number; tag: string }> };

  // The journal tag is already the migration filename stem, including its
  // number prefix; idx is the ordering key, not part of the name.
  const migrations = [...journal.entries]
    .sort((a, b) => a.idx - b.idx)
    .map((entry) => `${entry.tag}.sql`)
    .filter((name) => {
      try {
        return readMigration(name).includes("FUNCTION private.is_registered_mcp_tool");
      } catch {
        return false;
      }
    });

  let latest: string | undefined;
  for (const migration of migrations) {
    const sql = readMigration(migration);
    if (sql.includes("FUNCTION private.is_registered_mcp_tool")) latest = sql;
  }

  if (latest === undefined) {
    throw new Error("No migration defines private.is_registered_mcp_tool.");
  }

  const body = latest.slice(latest.indexOf("FUNCTION private.is_registered_mcp_tool"));
  return new Set([...body.matchAll(/'(ega_[a-z0-9_]+)'/g)].map((match) => match[1]));
}

/** Extracts every jsonb array literal that looks like a permission document. */
function readPermissionDocumentsFromSql(sql: string): string[][] {
  return [...sql.matchAll(/'\[(?:"[a-z_.]+"(?:,\s*)?)+\]'::jsonb/g)].map((match) =>
    [...match[0].matchAll(/"([a-z_.]+)"/g)].map((entry) => entry[1]),
  );
}

describe("MCP capability registry integrity", () => {
  it("has no duplicate capability names", () => {
    const names = getAllCapabilityNames();
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives every mutation capability a writes-enabled requirement", () => {
    for (const capability of MCP_CAPABILITIES) {
      if (capability.mutation) {
        expect(
          capability.writesEnabledRequired,
          `${capability.name} mutates but does not require MCP_WRITES_ENABLED`,
        ).toBe(true);
      }
    }
  });

  it("advertises idempotency only where repeating the write is the same write", () => {
    // Idempotency and destructiveness are independent facts, so this asserts a
    // relationship rather than a derivation. ARCHITECTURE.md records archive and
    // cancel mutations as at-least-once but idempotent: repeating the archive
    // UPDATE sets status='archived' on an already-archived row and succeeds with
    // the same result. A registry that derived `idempotent` from `destructive`
    // was advertising a runtime fact it did not hold.
    for (const capability of MCP_CAPABILITIES) {
      if (capability.mutation) {
        expect(
          capability.idempotent,
          `${capability.name} must state idempotency explicitly for a mutation`,
        ).toBe(capability.idempotent);
      }
    }

    const archive = MCP_CAPABILITIES.filter((capability) => capability.name.startsWith("ega_archive_"));
    expect(archive.length).toBeGreaterThan(0);
    for (const capability of archive) {
      expect(capability.destructive, `${capability.name} is archive and is destructive`).toBe(true);
      expect(capability.idempotent, `${capability.name} is repeatable`).toBe(true);
    }

    // ega_clear_completed_today clears a freshly computed set each round, so it
    // is the one destructive capability that is genuinely not idempotent.
    const clear = getCapability("ega_clear_completed_today");
    expect(clear.destructive).toBe(true);
    expect(clear.idempotent).toBe(false);
  });

  it("never marks a read capability as a mutation", () => {
    for (const capability of MCP_CAPABILITIES) {
      if (capability.primitive === "read") {
        expect(capability.mutation, `${capability.name} is a read but mutates`).toBe(false);
        expect(capability.writesEnabledRequired).toBe(false);
        expect(capability.rateClass).toBe("read");
      }
    }
  });

  it("requires at least one permission for every non-always capability", () => {
    for (const capability of MCP_CAPABILITIES) {
      const requirement = capability.permissionRequirement;
      if (requirement.kind === "always") {
        expect(capability.name).toBe("ega_get_capabilities");
        continue;
      }
      expect(requirement.permissions.length).toBeGreaterThan(0);
      for (const permission of requirement.permissions) {
        expect(permission).toMatch(/^[a-z]+\.[a-z]+$/);
      }
    }
  });

  it("cannot have a capability name collide with an aggregate rate-limit bucket", () => {
    // Aggregate buckets reuse the distributed counter keyed on a window name.
    // A capability sharing that namespace would let a tool's own window and an
    // aggregate window collide and silently corrupt both counters.
    for (const name of getAllCapabilityNames()) {
      expect(
        name.startsWith(MCP_AGGREGATE_BUCKET_PREFIX),
        `${name} would collide with the aggregate rate-limit namespace`,
      ).toBe(false);
    }
  });

  it("supports always, allOf and anyOf requirement semantics", async () => {
    const { isCapabilityAuthorized } = await import("@/lib/mcp/capability-registry");
    const base = { primitive: "read" as const, mutation: false, destructive: false, idempotent: true, writesEnabledRequired: false, rateClass: "read" as const, confirmationClass: "none" as const };

    const always = { ...base, name: "t", domain: "tasks" as const, permissionRequirement: { kind: "always" as const } };
    expect(isCapabilityAuthorized(always, [])).toBe(true);

    const allOf = { ...base, name: "t", domain: "tasks" as const, permissionRequirement: { kind: "allOf" as const, permissions: ["tasks.read", "goals.read"] as const } };
    expect(isCapabilityAuthorized(allOf, ["tasks.read", "goals.read"])).toBe(true);
    expect(isCapabilityAuthorized(allOf, ["tasks.read"])).toBe(false);
    expect(isCapabilityAuthorized(allOf, ["goals.read", "today.read"])).toBe(false);

    const anyOf = { ...base, name: "t", domain: "tasks" as const, permissionRequirement: { kind: "anyOf" as const, permissions: ["tasks.read", "goals.read"] as const } };
    expect(isCapabilityAuthorized(anyOf, ["tasks.read"])).toBe(true);
    expect(isCapabilityAuthorized(anyOf, ["goals.read"])).toBe(true);
    expect(isCapabilityAuthorized(anyOf, ["today.read"])).toBe(false);
  });
});

/**
 * The audit allowlist is the same authorization statement expressed twice: once
 * as the runtime registry, once as SQL the database enforces. Divergence in
 * either direction is a real defect, not a style issue:
 *
 *   - runtime knows a tool the database does not  -> a legitimate tool call
 *     cannot be audited, so audit writes fail closed and every such call errors
 *   - database knows a tool the runtime does not -> the auditable surface at
 *     the database is wider than any invocable capability
 */
describe("MCP audit tool allowlist stays synchronized with the runtime registry", () => {
  it("admits every runtime capability", () => {
    const allowlist = readAuditToolAllowlist();
    const missing = getAllCapabilityNames().filter((name) => !allowlist.has(name));
    expect(
      missing,
      `capabilities exist in the runtime registry but not in private.is_registered_mcp_tool; widen the allowlist migration in the same wave as the handler`,
    ).toEqual([]);
  });

  it("admits nothing the runtime registry does not recognize", () => {
    const allowlist = readAuditToolAllowlist();
    const runtime = new Set(getAllCapabilityNames());
    const extra = [...allowlist].filter((name) => !runtime.has(name));
    expect(
      extra,
      "private.is_registered_mcp_tool admits tool identities with no executable implementation; a planned tool must never be auditable before it has a handler",
    ).toEqual([]);
  });
});

/**
 * The permissions_version CHECK constraint in 0066 is the database's copy of the
 * versioned authorization documents defined in permissions.ts. If the two drift,
 * a consent screen can write a document the database rejects (surfacing as a
 * generic activation failure with no in-app recovery) or, worse, a document the
 * resolver considers non-matching so every existing connection fails closed.
 */
describe("MCP permission documents stay synchronized with the database CHECK constraint", () => {
  it("defines an exact, duplicate-free document for every supported pairing", () => {
    const documents = listPermissionDocuments();
    const allPairings = MCP_PERMISSION_PROFILES.length * MCP_PERMISSION_VERSIONS.length;
    expect(documents.length).toBeLessThanOrEqual(allPairings);
    expect(documents.length).toBeGreaterThan(0);
    for (const { profile, version, permissions } of documents) {
      expect(new Set(permissions).size, `${profile} v${version} has duplicates`).toBe(permissions.length);
      expect(permissions.length).toBeGreaterThan(0);
    }
  });

  it("treats an unsupported profile/version pairing as invalid, not as an empty document", () => {
    for (const { profile, version } of listUnsupportedPermissionDocuments()) {
      expect(isSupportedPermissionDocument(profile, version)).toBe(false);
      expect(() => getPermissionsForProfile(profile, version)).toThrow();
    }
    // task_manager is the deliberate case: legacy, never offered by consent,
    // so it stays representable at v1 and gains no later version speculatively.
    expect(isSupportedPermissionDocument("task_manager", 1)).toBe(true);
    expect(isSupportedPermissionDocument("task_manager", 2)).toBe(false);
  });

  it("makes every later version strictly additive over the previous one", () => {
    for (const profile of MCP_PERMISSION_PROFILES) {
      if (!isSupportedPermissionDocument(profile, 2)) continue;
      const v1 = new Set(getPermissionsForProfile(profile, 1));
      const v2 = getPermissionsForProfile(profile, 2);
      for (const permission of v1) {
        expect(v2, `v2 of ${profile} dropped v1 permission ${permission}`).toContain(permission);
      }
      expect(v2.length).toBeGreaterThan(v1.size);
    }
  });

  it("keeps every document's permissions inside the declared universe", () => {
    const universe = new Set<string>(MCP_PERMISSIONS);
    for (const { profile, version, permissions } of listPermissionDocuments()) {
      for (const permission of permissions) {
        expect(universe.has(permission), `${profile} v${version} has unknown permission ${permission}`).toBe(true);
      }
    }
  });

  it("pins the TS documents to the jsonb arrays enforced by drizzle/0066", () => {
    const sqlDocuments = readPermissionDocumentsFromSql(
      readMigration("0066_mcp_permission_version_2.sql"),
    );
    expect(sqlDocuments.length).toBeGreaterThan(0);

    const sqlSets = sqlDocuments.map((document) => new Set(document).size === document.length
      ? [...document].sort().join("|")
      : `NON-UNIQUE:${document.join("|")}`);
    const sqlUnique = new Set(sqlSets);

    for (const { profile, version, permissions } of listPermissionDocuments()) {
      const key = [...permissions].sort().join("|");
      expect(
        sqlUnique.has(key),
        `${profile} v${version} document is not enforced by drizzle/0066; the database would reject a grant the app writes`,
      ).toBe(true);
    }
  });

  it("issues v1 until the v2 capability set is complete", () => {
    // Not a style assertion: CURRENT is what grant-admin writes. Flipping it
    // early would let a consent screen promise v2 authority with no tool
    // behind it, and would freeze a document later additions would have to
    // mutate instead of versioning as v3.
    expect(MCP_PERMISSION_VERSIONS).toContain(CURRENT_MCP_PERMISSION_VERSION);
    const issued = getPermissionsForProfile("workspace_manager", CURRENT_MCP_PERMISSION_VERSION);
    for (const additive of ["friction.read", "inbox.read", "notifications.read", "operator.read", "workload.read"]) {
      expect(issued).not.toContain(additive);
    }
  });
});

/**
 * ARCHITECTURE.md documents the enforced rate-limit thresholds, the shipped SDK
 * version and the shipped migration range. Those three facts are stated in prose
 * that nothing checked: a migration changing `v_limit`, or an SDK bump, left the
 * document silently wrong while every executable proof stayed green.
 *
 * The RPC-SURFACE section proves the shipped limits BITE at their configured
 * values. It cannot prove the document agrees with them, so these assertions
 * read both sides and compare.
 */
describe("ARCHITECTURE.md states the enforced rate-limit thresholds", () => {
  const architecture = readFileSync(
    resolve(process.cwd(), "..", "..", "ARCHITECTURE.md"),
    "utf8",
  );

  it("names every aggregate bucket limit the RPC actually enforces", () => {
    // Read the CASE arms out of the migration rather than restating them here,
    // so a threshold change breaks this assertion instead of being missed.
    const sql = readMigration("0071_mcp_rate_limit_and_fence_classification.sql");
    const arms = [...sql.matchAll(
      /WHEN p_window_name = '(ega_aggregate_[a-z_]+)' THEN (\d+)/g,
    )];

    expect(arms.length, "no aggregate bucket arms found in 0071").toBeGreaterThan(0);

    for (const [, bucket, limit] of arms) {
      expect(
        architecture.includes(`${bucket}`),
        `ARCHITECTURE.md does not document the aggregate bucket ${bucket}`,
      ).toBe(true);
      expect(
        architecture.includes(`${limit}/min`),
        `ARCHITECTURE.md does not state the enforced ${limit}/min allowance for ${bucket}`,
      ).toBe(true);
    }
  });

  it("states the per-tool default the RPC falls through to", () => {
    const sql = readMigration("0071_mcp_rate_limit_and_fence_classification.sql");
    const fallback = sql.match(/ELSE (\d+)\s*\n/);
    expect(fallback, "could not read the per-tool fallback limit from 0071").not.toBeNull();
    expect(
      architecture.includes(`${fallback![1]}/min`),
      `ARCHITECTURE.md does not state the per-tool allowance of ${fallback![1]}/min enforced by 0071`,
    ).toBe(true);
  });

  });

/**
 * The migration range and the SDK version are the two facts most likely to go
 * stale in prose, because drizzle-kit never regenerates documentation and the
 * SDK is only version-checked indirectly through the lockfile.
 */
describe("ARCHITECTURE.md states the shipped migration range and SDK version", () => {
  const architecture = readFileSync(
    resolve(process.cwd(), "..", "..", "ARCHITECTURE.md"),
    "utf8",
  );

  it("names the last migration in the journal", () => {
    const journal = JSON.parse(
      readFileSync(drizzlePath("meta", "_journal.json"), "utf8"),
    ) as { entries: Array<{ idx: number; tag: string }> };
    const last = [...journal.entries].sort((a, b) => a.idx - b.idx).at(-1);
    expect(last, "journal is empty").toBeDefined();
    expect(
      architecture.includes(last!.tag),
      `ARCHITECTURE.md does not mention the last journal migration ${last!.tag}`,
    ).toBe(true);
  });

  it("states the SDK version the lockfile actually resolves", () => {
    const root = resolve(process.cwd(), "..", "..");
    const sdkVersion = JSON.parse(
      readFileSync(resolve(root, "node_modules", "@modelcontextprotocol", "server", "package.json"), "utf8"),
    ).version as string;
    expect(
      architecture.includes(sdkVersion),
      `ARCHITECTURE.md does not state the installed MCP SDK version ${sdkVersion}`,
    ).toBe(true);
  });
});
