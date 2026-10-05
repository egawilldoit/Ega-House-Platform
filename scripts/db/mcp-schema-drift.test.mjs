import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * The MCP permission-version security model must survive `drizzle-kit`.
 *
 * WHY THIS FILE EXISTS. `drizzle.config.ts` lists `src/db/mcp-schema.ts` in
 * `schema`, so that file is an INPUT to `db:generate` / `db:push`, not a
 * description of the database. `push` DROPS every CHECK constraint the
 * declarative schema does not declare and never recreates it, and `generate`
 * emits whatever the declarative schema does declare as the next migration. The
 * MCP permission-version model lives only in hand-written migrations (0057,
 * 0066, 0077), so anything the declarative schema omits or weakens is a live
 * downgrade of the security model rather than dead documentation.
 *
 * Observed on this tree before this guard existed, against a PostgreSQL 16 built
 * by applying all 78 journal migrations per-file inside per-file transactions:
 * `drizzle-kit push` emitted exactly
 *
 *   ALTER TABLE "mcp_authorization_grants"
 *     DROP CONSTRAINT "mcp_authorization_grants_profile_permissions_check";
 *
 * and nothing that recreates it. Afterwards the same database accepted a
 * `(task_manager, 2)` grant, an `active` `read_only` row whose document repeated
 * `projects.read`, and an `active` `read_only` v1 row carrying the v2
 * ten-permission document - all three refused with 23514 before the push, because
 * the application can never authorise them.
 *
 * WHAT THIS PROVES, WITHOUT A DATABASE. It renders `src/db/mcp-schema.ts`
 * through drizzle-kit itself, so it observes what the tool emits rather than
 * what a human typed, and then asserts:
 *
 *   1. every CHECK the journal's final state defines for
 *      `public.mcp_authorization_grants` is declared under the same name, which
 *      is exactly the property that stops `push` from dropping it;
 *   2. each declared predicate is the same SQL as the migration that last wrote
 *      it, modulo whitespace, identifier quoting and case;
 *   3. the permission documents inside
 *      `mcp_authorization_grants_profile_permissions_check` are exactly the
 *      documents `apps/web/src/lib/mcp/permissions.ts` declares, plus the legacy
 *      and retired documents the journal keeps representable on a terminal row.
 *      That is what stops `src/db`'s local copy of the documents from becoming a
 *      second source of truth.
 *
 * The database-level half - real `pg_get_constraintdef` equality and an actual
 * `drizzle-kit push` against a journal-built database - is
 * `scripts/db/mcp-schema-drift-verify.mjs`, because a rendered string is not the
 * same claim as a parsed and evaluated constraint.
 *
 * Run: `npm run test:mcp-schema-drift`
 */

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const TABLE = "mcp_authorization_grants";

/**
 * Divergences between the declarative schema and the journal that this guard
 * deliberately tolerates, each with the reason it is not fixed here. Each entry
 * must be equal after `equivalentAfter`, so any FURTHER change to either side
 * still fails.
 *
 * `mcp_authorization_grants_resource_uri_check`: drizzle/0037 wrote the loopback
 * alternation over-escaped. In a `standard_conforming_strings` literal,
 * `127\\.0\\.0\\.1` reaches the regex engine as `\\.`, which matches a literal
 * backslash followed by any character, so the migration's own pattern cannot
 * match `127.0.0.1`; the declarative schema spells the same regex correctly and
 * is the side that behaves as 0037's comment intends. Migration truth is
 * therefore NOT unambiguous for this constraint, so neither side is changed:
 * reproducing the broken escaping would enshrine a bug in the schema authority,
 * and correcting the migration is outside this change's scope.
 */
const KNOWN_DIVERGENCES = {
  "mcp_authorization_grants_resource_uri_check": {
    reason: "0037 over-escaped the loopback alternation; reported, deliberately not changed",
    equivalentAfter: (predicate) => predicate.replaceAll("\\\\", "\\"),
  },
};

// ---------------------------------------------------------------------------
// Migration truth: replay the journal's CHECK definitions in journal order
// ---------------------------------------------------------------------------

/**
 * Every `CONSTRAINT "<name>" CHECK (<predicate>)` in a CREATE TABLE.
 *
 * The predicate ends at the matching close paren, found by counting, because the
 * predicates nest parentheses (`IN (1, 2)`, the OR branches of the document
 * check).
 */
function checksFromCreateTable(createTable) {
  const checks = new Map();
  const pattern = /CONSTRAINT\s+"([^"]+)"\s+CHECK\s*\(/g;
  for (let match = pattern.exec(createTable); match; match = pattern.exec(createTable)) {
    const open = pattern.lastIndex;
    let depth = 1;
    let index = open;
    while (depth > 0 && index < createTable.length) {
      if (createTable[index] === "(") depth += 1;
      if (createTable[index] === ")") depth -= 1;
      index += 1;
    }
    checks.set(match[1], createTable.slice(open, index - 1));
  }
  return checks;
}

/** The text of the `CREATE TABLE` this migration creates for the table, if any. */
function createdTable(text) {
  const match = new RegExp(`CREATE TABLE(?: IF NOT EXISTS)? "${TABLE}" \\(`).exec(text);
  if (!match) return null;
  const end = text.indexOf("\n);", match.index);
  return text.slice(match.index, end === -1 ? undefined : end + 3);
}

/**
 * The final CHECK definition each migration leaves on this table, keyed by
 * constraint name. Last writer wins, which is how 0077's restatement supersedes
 * 0066's and 0039's.
 *
 * Both shapes this journal uses are read: the inline `CONSTRAINT ... CHECK` of a
 * creating `CREATE TABLE` (0037) and a later `ALTER TABLE ... ADD CONSTRAINT ...
 * CHECK`. Reading only the second would miss the three constraints 0037 created,
 * and a guard that misses those cannot notice them being dropped.
 */
function journalCheckConstraints(tags) {
  const definitions = new Map();
  for (const tag of tags) {
    const text = readFileSync(path.join(ROOT, "drizzle", `${tag}.sql`), "utf8");
    if (!text.includes(TABLE)) continue;

    const table = createdTable(text);
    if (table) {
      for (const [name, predicate] of checksFromCreateTable(table)) {
        definitions.set(name, { tag, predicate });
      }
    }

    for (const statement of text.split(/;\s*/)) {
      if (!statement.includes(TABLE)) continue;
      if (statement.includes("DROP CONSTRAINT")) continue;
      const match = statement.match(/ADD\s+CONSTRAINT\s+(\w+)\s+CHECK\s*\(([\s\S]*)\)\s*$/i);
      if (!match) continue;
      definitions.set(match[1], { tag, predicate: match[2] });
    }
  }
  return definitions;
}

function journalTags() {
  const journal = JSON.parse(readFileSync(path.join(ROOT, "drizzle", "meta", "_journal.json"), "utf8"));
  return journal.entries.map((entry) => entry.tag);
}

// ---------------------------------------------------------------------------
// Declarative truth: what drizzle-kit actually emits
// ---------------------------------------------------------------------------

/**
 * The drizzle-kit CLI entry point, located through the package's own manifest
 * rather than a hard-coded path so a drizzle-kit layout change fails loudly here
 * instead of silently skipping the render.
 */
function drizzleKitBin() {
  const entry = createRequire(import.meta.url).resolve("drizzle-kit");
  const manifest = JSON.parse(readFileSync(path.join(path.dirname(entry), "package.json"), "utf8"));
  const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.["drizzle-kit"];
  assert.ok(bin, "drizzle-kit's package.json declares no bin entry");
  return path.join(path.dirname(entry), bin);
}

/**
 * Render `src/db/mcp-schema.ts` through drizzle-kit and return the CREATE TABLE
 * it emits for this table.
 *
 * `generate` needs a journal to diff against, so the journal is copied into a
 * throwaway directory OUTSIDE the repository and `node_modules` is symlinked
 * beside it: drizzle-kit resolves its own `defineConfig` import from the config
 * file's own directory, so a config written under `os.tmpdir()` needs that link.
 * Nothing is written inside the repository, and no database is contacted -
 * `generate` reads only the journal and the schema files.
 */
function renderDeclaredCreateTable() {
  const workdir = mkdtempSync(path.join(os.tmpdir(), "mcp-schema-drift-"));
  try {
    cpSync(path.join(ROOT, "drizzle"), path.join(workdir, "drizzle"), { recursive: true });
    symlinkSync(path.join(ROOT, "node_modules"), path.join(workdir, "node_modules"), "dir");
    writeFileSync(
      path.join(workdir, "drizzle.config.ts"),
      [
        'import { defineConfig } from "drizzle-kit";',
        "export default defineConfig({",
        `  schema: [${JSON.stringify(path.join(ROOT, "src", "db", "schema.ts"))}, ${JSON.stringify(path.join(ROOT, "src", "db", "mcp-schema.ts"))}],`,
        '  out: "./drizzle",',
        '  dialect: "postgresql",',
        `  dbCredentials: { url: process.env.DATABASE_URL ?? ${JSON.stringify("postgresql://postgres:postgres@127.0.0.1:5432/postgres")} },`,
        "});",
        "",
      ].join("\n"),
    );

    execFileSync(
      process.execPath,
      [drizzleKitBin(), "generate", "--config", "./drizzle.config.ts", "--name", "drift_probe"],
      { cwd: workdir, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" },
    );

    const journal = JSON.parse(readFileSync(path.join(workdir, "drizzle", "meta", "_journal.json"), "utf8"));
    const tag = journal.entries[journal.entries.length - 1].tag;
    const emitted = readFileSync(path.join(workdir, "drizzle", `${tag}.sql`), "utf8");
    const table = createdTable(emitted);
    assert.ok(table, `drizzle-kit emitted no CREATE TABLE for ${TABLE}`);
    return table;
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
}

/**
 * Reduce a predicate to a comparable form: whitespace collapsed, SQL keywords
 * case-folded, identifier quoting removed, json array literals canonicalised.
 *
 * Quoting is dropped because drizzle-kit emits `"mcp_authorization_grants".
 * "status"` where the migrations write `status`, and that is not a difference in
 * what the database accepts. The two spellings of a jsonb literal are normalised
 * for the same reason and only for that reason: this journal is not internally
 * consistent about the comma spacing inside them - 0077 writes `'["a","b"]'` and
 * 0057 writes `'["a", "b"]'` - while PostgreSQL parses both to the same value and
 * reprints one canonical form. Nothing else is normalised, so a changed operator,
 * operand, literal or branch is still a difference.
 */
function normalizePredicate(predicate) {
  const collapsed = predicate.replace(/\s+/g, " ").trim().toLowerCase();
  const canonical = collapsed.replaceAll(/'(\[[^\]]*\])'/g, (_literal, body) => `'${JSON.stringify(JSON.parse(body))}'`);
  return canonical.replaceAll(`"${TABLE}".`, "").replaceAll('"', "");
}

/**
 * Reduce a predicate for the document assertions: as `normalizePredicate`, but
 * double quotes are PRESERVED, because they delimit the elements inside the jsonb
 * literals and the assertions have to decode them.
 */
function compactPredicate(predicate) {
  return predicate.replace(/\s+/g, " ").trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// The authoritative application list
// ---------------------------------------------------------------------------

/**
 * Load `apps/web/src/lib/mcp/permissions.ts`, the authoritative permission
 * documents. It has no imports, so a CommonJS transpile plus a `new Function` is
 * enough and keeps this test free of a TypeScript loader;
 * `scripts/architecture/check-boundaries.mjs` already depends on `typescript` the
 * same way.
 */
function loadAuthoritativePermissions() {
  const source = readFileSync(
    path.join(ROOT, "apps", "web", "src", "lib", "mcp", "permissions.ts"),
    "utf8",
  );
  const { outputText, diagnostics } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: "permissions.ts",
    reportDiagnostics: true,
  });
  assert.deepEqual(
    (diagnostics ?? []).map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")),
    [],
    "permissions.ts did not transpile cleanly",
  );
  const moduleShim = { exports: {} };
  new Function("exports", "module", "require", outputText)(
    moduleShim.exports,
    moduleShim,
    (specifier) => assert.fail(`permissions.ts unexpectedly imports ${specifier}`),
  );
  return moduleShim.exports;
}

/**
 * Documents the journal still pins but the application no longer serves: the two
 * pre-0050 consent documents that 0050 terminalised, and the retired
 * delivery_observer document. They stay representable on a terminal row so that
 * revoking or failing such a grant still succeeds.
 */
function supersededDocuments() {
  return [
    ["legacy read_only", ["projects.read", "goals.read", "tasks.read"]],
    ["legacy task_manager", ["projects.read", "goals.read", "tasks.read", "tasks.create", "tasks.update"]],
    [
      "retired delivery_observer",
      ["delivery_runs.read", "delivery_events.read", "delivery_artifacts.read"],
    ],
  ];
}

const asJson = (permissions) => JSON.stringify(permissions);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const journal = journalCheckConstraints(journalTags());
const createTable = renderDeclaredCreateTable();
const declared = checksFromCreateTable(createTable);

test("drizzle-kit renders mcp_authorization_grants from the declarative schema", () => {
  assert.ok(
    createTable.startsWith(`CREATE TABLE "${TABLE}"`),
    "the rendered DDL must contain the whole table, otherwise every assertion below is vacuous",
  );
  for (const column of [
    "owner_user_id",
    "oauth_client_id",
    "resource_uri",
    "client_name",
    "status",
    "permission_profile",
    "permissions",
    "permissions_version",
    "approved_at",
    "revoked_at",
    "last_used_at",
    "created_at",
    "updated_at",
  ]) {
    assert.match(createTable, new RegExp(`"${column}"\\s`), `rendered DDL lost column ${column}`);
  }
});

test("every CHECK the journal defines for mcp_authorization_grants is declared under the same name", () => {
  const missing = [...journal.keys()].filter((name) => !declared.has(name));
  assert.deepEqual(
    missing,
    [],
    `src/db/mcp-schema.ts does not declare ${missing.join(", ")}; drizzle-kit push DROPS an undeclared CHECK constraint and never recreates it`,
  );
});

test("the declarative schema declares no CHECK the journal never defined", () => {
  const invented = [...declared.keys()].filter((name) => !journal.has(name));
  assert.deepEqual(
    invented,
    [],
    `src/db/mcp-schema.ts declares ${invented.join(", ")}, which no migration creates; db:generate would emit a constraint with no migration behind it`,
  );
});

for (const [name, definition] of journal) {
  test(`${name} matches the definition in ${definition.tag}`, () => {
    const actual = declared.get(name);
    assert.ok(actual, `${name} is not declared at all`);
    const known = KNOWN_DIVERGENCES[name];
    const resolve = known ? known.equivalentAfter : (predicate) => predicate;
    assert.equal(
      resolve(normalizePredicate(actual)),
      resolve(normalizePredicate(definition.predicate)),
      known
        ? `${name} differs from ${definition.tag} by MORE than the documented divergence (${known.reason})`
        : `${name} in src/db/mcp-schema.ts is not the constraint ${definition.tag} defines`,
    );
  });
}

test("permissions_version is pinned to the versions 0066 declares, not merely positive", () => {
  const predicate = normalizePredicate(
    declared.get("mcp_authorization_grants_permissions_version_check"),
  );
  assert.ok(
    predicate.includes("permissions_version in (1, 2)"),
    `expected permissions_version IN (1, 2); got ${predicate}`,
  );
  assert.doesNotMatch(
    predicate,
    /permissions_version\s*[<>=]/,
    "the version must not be a comparison: `> 0` is the pre-0066 predicate and leaves every future version representable",
  );
});

test("(profile, permissions_version) names exactly one permission document, with multiplicity pinned", () => {
  const predicate = compactPredicate(
    declared.get("mcp_authorization_grants_profile_permissions_check"),
  );

  const branches = [
    ...predicate.matchAll(
      /permissions_version\s*=\s*(\d+)\s+and\s+permission_profile\s*=\s*'([a-z_]+)'\s+and\s+jsonb_array_length\(permissions\)\s*=\s*(\d+)\s+and\s+permissions\s*<\@\s*'(\[[^\]]*\])'::jsonb\s+and\s+permissions\s*\@\>\s*'(\[[^\]]*\])'::jsonb/g,
    ),
  ].map((branch) => ({
    version: Number(branch[1]),
    profile: branch[2],
    length: Number(branch[3]),
    subsetOf: JSON.parse(branch[4]),
    supersetOf: JSON.parse(branch[5]),
  }));

  assert.ok(branches.length > 0, "no version-keyed document branch found in the declared predicate");
  for (const branch of branches) {
    // The branch names ONE document exactly when `@>` pins every element of it
    // and `jsonb_array_length` pins how many there are: `P ⊇ T` with `|P| = |T|`
    // forces `P = T`. `<@` is then a consistency window, deliberately wider on
    // the terminal branches (0077 keeps the pre-0050 three-permission read_only
    // and five-permission task_manager documents representable there), so it must
    // CONTAIN the exact document rather than equal it.
    assert.equal(
      branch.length,
      branch.supersetOf.length,
      `${branch.profile} v${branch.version} pins length ${branch.length} but its \`@>\` document has ${branch.supersetOf.length} permissions, so more than one document satisfies it`,
    );
    assert.equal(
      new Set(branch.supersetOf).size,
      branch.supersetOf.length,
      `${branch.profile} v${branch.version} names a document with a repeated permission, which \`jsonb_array_length\` cannot distinguish`,
    );
    assert.ok(
      branch.supersetOf.every((permission) => branch.subsetOf.includes(permission)),
      `${branch.profile} v${branch.version} is unsatisfiable: its \`@>\` document is not inside its \`<@\` window`,
    );
  }

  assert.deepEqual(
    [...predicate.matchAll(/status\s+in\s+\(([^)]*)\)/g)].map((match) => match[1]),
    ["'active', 'pending'", "'failed', 'revoked'"],
    "the document must be keyed by status class: an active/pending row and a terminal row may hold different documents",
  );

  assert.deepEqual(
    [
      ...predicate.matchAll(
        /permission_profile\s*=\s*'([a-z_]+)'\s+and\s+permissions\s*=\s*'(\[[^\]]*\])'::jsonb/g,
      ),
    ].map((match) => ({ profile: match[1], permissions: JSON.parse(match[2]) })),
    [
      {
        profile: "delivery_observer",
        permissions: ["delivery_runs.read", "delivery_events.read", "delivery_artifacts.read"],
      },
    ],
    "only the retired delivery_observer document may be pinned without a version",
  );
});

test("the documents the declared CHECK pins are exactly the authoritative ones", () => {
  const permissions = loadAuthoritativePermissions();
  const predicate = compactPredicate(
    declared.get("mcp_authorization_grants_profile_permissions_check"),
  );

  const supported = permissions
    .listPermissionDocuments()
    .map((entry) => [`${entry.profile} v${entry.version}`, [...entry.permissions]]);
  assert.ok(supported.length > 0, "permissions.ts returned no documents, so the checks below are vacuous");

  for (const [label, document] of supported) {
    assert.ok(
      predicate.includes(asJson(document).toLowerCase()),
      `the declared CHECK does not pin the authoritative document for ${label}: ${asJson(document)}`,
    );
  }

  // Every jsonb array literal in the predicate is a document the application
  // serves, or one the journal keeps representable on a terminal row. An array
  // that is neither would be a document no code path can ever authorise.
  const allowed = new Set(
    [...supported.map(([, document]) => document), ...supersededDocuments().map(([, document]) => document)].map(
      asJson,
    ),
  );
  const pinned = [...predicate.matchAll(/permissions\s*(?:<\@|\@\>|=)\s*'(\[[^\]]*\])'::jsonb/g)].map(
    (match) => JSON.parse(match[1]),
  );
  assert.ok(pinned.length > 0, "the declared predicate pins no document at all");
  for (const document of pinned) {
    assert.ok(
      allowed.has(asJson(document)),
      `the declared CHECK pins a document nothing authorises: ${asJson(document)}`,
    );
  }

  // Both sides agree on which (profile, version) pairs exist. A pair
  // permissions.ts declares INVALID must have no version-keyed branch here, or
  // the database would accept a document the resolver can never resolve.
  for (const version of permissions.MCP_PERMISSION_VERSIONS) {
    for (const profile of permissions.MCP_PERMISSION_PROFILES) {
      const document = supported.find(([label]) => label === `${profile} v${version}`)?.[1];
      const branch = predicate.includes(
        `permissions_version = ${version} and permission_profile = '${profile}'`,
      );
      if (document) {
        assert.ok(
          branch && predicate.includes(`jsonb_array_length(permissions) = ${document.length}`),
          `${profile} v${version} is a supported document in permissions.ts but the declared CHECK has no exact branch for it`,
        );
      } else {
        assert.ok(
          !branch,
          `${profile} v${version} has no document in permissions.ts but the declared CHECK admits one`,
        );
      }
    }
  }
});

test("the CI jobs that gate this tree run both halves of the drift guard", () => {
  const workflow = readFileSync(
    path.join(ROOT, ".github", "workflows", "unified-platform-validation.yml"),
    "utf8",
  );
  const jobSection = (name) => {
    const start = workflow.search(new RegExp(`^  ${name}:\\n`, "m"));
    assert.notEqual(start, -1, `job ${name} exists`);
    const next = workflow.slice(start + 1).search(/^  [a-z][a-z0-9-]*:\n/m);
    return next === -1 ? workflow.slice(start) : workflow.slice(start, start + 1 + next);
  };

  // `regressions` is the only job that runs unconditionally, so the database-free
  // half lives there. The database half needs the PostgreSQL service, so it lives
  // in `db-invariants`, whose `changes.db` filter already covers src/db/** and
  // scripts/db/**.
  assert.match(
    jobSection("regressions"),
    /npm run test:mcp-schema-drift\b/,
    "the regressions job must run the declarative-schema drift test",
  );
  assert.match(
    jobSection("db-invariants"),
    /mcp-schema-drift-verify\.mjs --url "\$PROOF_DATABASE_URL"/,
    "the db-invariants job must run the database-level drift proof",
  );
  assert.match(
    readFileSync(path.join(ROOT, "package.json"), "utf8"),
    /"test:mcp-schema-drift":\s*"node --test scripts\/db\/mcp-schema-drift\.test\.mjs"/,
    "package.json must expose the drift test so CI and a human run the same command",
  );
});