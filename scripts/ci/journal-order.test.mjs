import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

/**
 * The drizzle migration journal must be totally ordered by the key
 * `drizzle-kit` actually migrates on.
 *
 * WHY THIS EXISTS. `drizzle-orm`'s migrator decides what to apply with, in
 * `pg-core/dialect.js`:
 *
 *   select id, hash, created_at from drizzle.__drizzle_migrations
 *     order by created_at desc limit 1
 *   ...
 *   if (!lastDbMigration || Number(lastDbMigration.created_at) < migration.folderMillis)
 *
 * and `folderMillis` is the journal entry's `when`. It compares ONE number
 * against the HIGHEST recorded one, so the only ordering the migrator honours
 * is `when` — array position and `idx` are not consulted.
 *
 * This repository's journal shipped three entries sharing `when`
 * 1787880000023 (0074, 0076, 0077), and 0074's value was LOWER than 0073's
 * 1787880000024. A database already migrated through 0073 therefore compared
 * 1787880000024 < 1787880000023, which is false, and `migrate()`:
 *
 *   - reported "migrations applied successfully",
 *   - applied ONLY 0078 (whose `when` was far ahead),
 *   - silently never applied 0074, 0076 or 0077,
 *   - and recorded 0078 as the newest row, so every later run skipped them too.
 *
 * That leaves a deployment with no operation-identity pairing constraint (0074),
 * no rate-limiter EXECUTE grant (0076) and the pre-0077 permission-document
 * constraint, while reporting success. No error, no warning, no repair path
 * except hand-editing `drizzle.__drizzle_migrations`.
 *
 * The behavioural half of this guard is `scripts/db/journal-order-verify.mjs`,
 * which drives the real `migrate()` at each tail boundary. This file is the
 * static half: it needs no database, so it runs in the unconditional
 * `regressions` job and catches the shape the moment it is reintroduced.
 *
 * WHAT IT DELIBERATELY DOES NOT ASSERT. It does not assert any particular value
 * of `when` — the values carry no meaning beyond ordering, and re-stamping them
 * is a legitimate maintenance action. It asserts only the property the migrator
 * depends on.
 */

const REPO_ROOT = new URL("../../", import.meta.url);
const JOURNAL_PATH = new URL("drizzle/meta/_journal.json", REPO_ROOT);
const DRIZZLE_DIR = new URL("drizzle/", REPO_ROOT);

const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf8"));
const entries = journal.entries;

test("the journal is non-empty", () => {
  // Every assertion below is an inequality or a membership test over `entries`.
  // An empty or missing journal would satisfy them all, so pin the premise.
  assert.ok(Array.isArray(entries), "drizzle/meta/_journal.json has no `entries` array");
  assert.ok(entries.length > 0, "the migration journal declares no entries");
});

test("every journal entry has a numeric `when`", () => {
  const malformed = entries
    .map((entry, index) => ({ index, when: entry.when }))
    .filter(({ when }) => typeof when !== "number" || !Number.isFinite(when));
  assert.deepEqual(
    malformed,
    [],
    `these journal entries have a non-numeric or non-finite "when", which the ` +
      `migrator would compare as NaN and never apply: ${JSON.stringify(malformed)}`,
  );
});

test("`when` is strictly increasing across the whole journal", () => {
  const breaks = [];
  for (let i = 1; i < entries.length; i += 1) {
    if (!(entries[i - 1].when < entries[i].when)) {
      breaks.push(
        `${entries[i - 1].tag} (${entries[i - 1].when}) -> ` +
          `${entries[i].tag} (${entries[i].when})`,
      );
    }
  }
  assert.deepEqual(
    breaks,
    [],
    "the migrator applies an entry only when the highest recorded created_at is " +
      "less than that entry's `when`, so a non-increasing pair is silently " +
      `skipped rather than applied. Offending transitions: ${breaks.join("; ")}`,
  );
});

test("no two journal entries share a `when`", () => {
  const seen = new Map();
  const duplicates = [];
  for (const entry of entries) {
    if (seen.has(entry.when)) duplicates.push(`${seen.get(entry.when)} and ${entry.tag}`);
    else seen.set(entry.when, entry.tag);
  }
  assert.deepEqual(
    duplicates,
    [],
    `these entries share a "when": ${duplicates.join("; ")}. A shared value ` +
      "makes the migrator's single-number comparison ambiguous, because " +
      "`order by created_at desc limit 1` cannot tell them apart.",
  );
});

test("`idx` is dense, monotonic, and matches journal order", () => {
  const problems = [];
  entries.forEach((entry, position) => {
    if (entry.idx !== position) {
      problems.push(`position ${position} carries idx ${entry.idx} (${entry.tag})`);
    }
  });
  assert.deepEqual(problems, [], `journal idx must be dense and 0-based: ${problems.join("; ")}`);
});

test("every journal tag names a file that exists, and every migration file is in the journal", () => {
  const journalTags = new Set(entries.map((entry) => entry.tag));

  const drizzleFiles = Array.from(readdirSync(DRIZZLE_DIR))
    .filter((name) => name.endsWith(".sql"))
    .map((name) => name.replace(/\.sql$/, ""));

  const missingFiles = [...journalTags].filter((tag) => !drizzleFiles.includes(tag));
  assert.deepEqual(
    missingFiles,
    [],
    `these journal tags name no drizzle/*.sql file, so the migrator would record ` +
      `them as applied without running anything: ${missingFiles.join(", ")}`,
  );

  const orphans = drizzleFiles.filter((file) => !journalTags.has(file));
  assert.deepEqual(
    orphans,
    [],
    `these drizzle/*.sql files are not in the journal and would NEVER be applied ` +
      `by migrate() or drizzle-kit migrate: ${orphans.join(", ")}`,
  );
});

test("the behavioural guard that drives the real migrator is wired into CI", () => {
  // The static checks above prove the shape. The property that actually matters
  // — that the real `migrate()` applies every remaining entry — is proven by a
  // database-backed verifier, and a verifier nobody runs proves nothing.
  const workflow = readFileSync(
    new URL(".github/workflows/unified-platform-validation.yml", REPO_ROOT),
    "utf8",
  );
  assert.match(
    workflow,
    /journal-order-verify\.mjs/,
    "scripts/db/journal-order-verify.mjs is not referenced by the CI workflow; " +
      "the behavioural half of this guard would gate nothing",
  );
});