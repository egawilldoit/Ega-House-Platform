#!/usr/bin/env node
/**
 * Real HTTP + real Postgres proof for the owner-scoped personal expense ledger
 * (PO-06 Slice A, issue #346).
 *
 * Applies the full drizzle migration journal to a disposable Postgres, then
 * drives the actual Hono app with its injected `verifyToken` and
 * `createRequestClient` seams. A small PostgREST-compatible Supabase shim
 * translates the builder calls used by the data-access repositories into
 * parameterized SQL executed as role `authenticated` with
 * `request.jwt.claim.sub` set to the verified owner.
 *
 * Proves:
 *   AUTH        - anonymous requests answer 401 before any database access.
 *   CRUD        - owner A create -> get -> list -> edit -> delete with durable
 *                 database state; owner B cannot read/update/delete owner A's
 *                 rows and sees an empty list.
 *   IDEMPOTENCY - the owner+key receipt is bound to the immutable original
 *                 create payload, so retries replay the current row after edits
 *                 or soft deletes, while edited/different payloads conflict;
 *                 concurrent double submit creates exactly one row.
 *   MONEY       - centimes are exact; zero/negative/fractional/overflow/string
 *                 amounts, impossible calendar dates/clock values and control
 *                 characters answer 400 VALIDATION.
 *   TIME        - explicit IANA timezone and owner time-context windows use
 *                 half-open UTC boundaries including a DST day.
 *   PAGINATION  - occurred_at desc, id desc with bounded limit/offset and an
 *                 exact hasMore flag.
 *   SOFT DELETE - deleted rows disappear from get/list; repeat and concurrent
 *                 deletes are idempotent and bump the version once.
 *   AUTHZ       - a verified client_id token cannot insert (403 FORBIDDEN) and
 *                 sees no owner rows.
 *
 * Usage:
 *   node --import tsx scripts/db/personal-expenses-api-verify.mjs --url <postgres-url>
 *
 * The database identified by --url is destroyed by this script. Only point it
 * at a throwaway database.
 */
import { readFile } from "node:fs/promises";
import { argv, exit } from "node:process";

import postgres from "postgres";

import { createApp } from "@ega/server";

const DRIZZLE_DIR = new URL("../../drizzle/", import.meta.url);
const MIGRATION_TAG = "0088_personal_expenses";

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";
const TOKEN_A = "proof-token-owner-a";
const TOKEN_B = "proof-token-owner-b";
const TOKEN_OAUTH_A = "proof-token-oauth-owner-a";
const NOW = new Date("2026-11-07T12:00:00.000Z");

function parseArgs() {
  const args = {};
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === "--url") args.url = rest[++i];
  }
  if (!args.url) {
    console.error("Missing required --url <postgres-url>");
    exit(2);
  }
  return args;
}

function log(section, message) {
  console.log(`[${section}] ${message}`);
}

function assert(condition, message) {
  if (!condition) {
    console.error(`[PROOF] FAILED: ${message}`);
    exit(1);
  }
}

async function readJournal() {
  const journal = JSON.parse(
    await readFile(new URL("meta/_journal.json", DRIZZLE_DIR), "utf8"),
  );
  return journal.entries.map((entry) => entry.tag);
}

function splitStatements(text) {
  return text
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

async function applyFile(sql, tag) {
  const text = await readFile(new URL(`${tag}.sql`, DRIZZLE_DIR), "utf8");
  const statements = splitStatements(text);
  for (const statement of statements) await sql.unsafe(statement);
  return statements.length;
}

async function resetDatabase(sql) {
  await sql.unsafe(
    `DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS auth CASCADE; DROP SCHEMA IF EXISTS automation CASCADE; CREATE SCHEMA public;`,
  );
  log("RESET", "public/auth/automation dropped and public recreated");
}

async function applySupabaseShim(sql) {
  await sql.unsafe(`
    DO $shim$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN CREATE ROLE supabase_auth_admin NOLOGIN; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
    END
    $shim$;
  `);
  await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS auth;`);
  await sql.unsafe(
    `GRANT USAGE ON SCHEMA public TO anon, authenticated, supabase_auth_admin;`,
  );
  await sql.unsafe(`GRANT USAGE ON SCHEMA auth TO authenticated;`);
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY,
      email text NOT NULL
    );
  `);
  await sql.unsafe(`
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE AS $fn$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $fn$;
  `);
  await sql.unsafe(`
    CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
    LANGUAGE sql STABLE AS $fn$
      SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
    $fn$;
  `);
  await sql.unsafe(`
    INSERT INTO auth.users (id, email) VALUES
      ('${OWNER_A}'::uuid, 'ab.mortaki@gmail.com'),
      ('${OWNER_B}'::uuid, 'owner-b@example.test')
    ON CONFLICT (id) DO NOTHING;
  `);
  await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS automation;`);
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS automation.implementation_runs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id varchar(64),
      linear_issue_id varchar(64),
      linear_issue_identifier varchar(64),
      linear_issue_url text,
      attempt_number integer NOT NULL DEFAULT 1,
      status varchar(48) NOT NULL DEFAULT 'queued',
      claimed_by varchar(64),
      heartbeat_at timestamptz,
      lease_expires_at timestamptz,
      started_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now(),
      finished_at timestamptz,
      failure_code varchar(64),
      pr_number bigint,
      created_at timestamptz DEFAULT now()
    );
  `);
  log("SHIM", "Supabase compatibility objects ready");
}

// ---------------------------------------------------------------------------
// Minimal PostgREST-compatible Supabase shim
// ---------------------------------------------------------------------------

function ident(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Unsafe SQL identifier: ${name}`);
  }
  return `"${name}"`;
}

function projection(columns) {
  if (!columns || columns.trim() === "*") return "*";
  return columns
    .split(",")
    .map((column) => ident(column.trim()))
    .join(", ");
}

function toPostgrestRows(rows) {
  return rows.map((row) => {
    const out = {};
    for (const [key, value] of Object.entries(row)) {
      out[key] = value instanceof Date ? value.toISOString() : value;
    }
    return out;
  });
}

class QueryBuilder {
  constructor(shim, table) {
    this.shim = shim;
    this.table = table;
    this.mode = "select";
    this.columns = null;
    this.payload = null;
    this.onConflict = null;
    this.filters = [];
    this.orders = [];
    this.limitValue = null;
    this.offsetValue = 0;
  }

  select(columns = "*") {
    this.columns = columns;
    return this;
  }
  insert(payload) {
    this.mode = "insert";
    this.payload = Array.isArray(payload) ? payload : [payload];
    return this;
  }
  update(payload) {
    this.mode = "update";
    this.payload = payload;
    return this;
  }
  upsert(payload, options = {}) {
    this.mode = "upsert";
    this.payload = Array.isArray(payload) ? payload : [payload];
    this.onConflict = options.onConflict ?? "id";
    return this;
  }
  delete() {
    this.mode = "delete";
    return this;
  }
  eq(column, value) {
    this.filters.push({ column, op: "eq", value });
    return this;
  }
  is(column, value) {
    this.filters.push({ column, op: "is", value });
    return this;
  }
  gte(column, value) {
    this.filters.push({ column, op: "gte", value });
    return this;
  }
  lt(column, value) {
    this.filters.push({ column, op: "lt", value });
    return this;
  }
  order(column, options = {}) {
    this.orders.push({ column, ascending: options.ascending !== false });
    return this;
  }
  range(from, to) {
    this.offsetValue = from;
    this.limitValue = to - from + 1;
    return this;
  }
  limit(count) {
    this.limitValue = count;
    return this;
  }
  maybeSingle() {
    return this.execute({ single: true, maybe: true });
  }
  single() {
    return this.execute({ single: true, maybe: false });
  }
  then(fulfilled, rejected) {
    return this.execute({ single: false, maybe: false }).then(fulfilled, rejected);
  }

  whereSql(params) {
    if (this.filters.length === 0) return "";
    const clauses = this.filters.map((filter) => {
      const column = ident(filter.column);
      if (filter.op === "is") {
        return filter.value === null
          ? `${column} is null`
          : `${column} is not null`;
      }
      const operator =
        filter.op === "eq" ? "=" : filter.op === "gte" ? ">=" : "<";
      params.push(filter.value);
      return `${column} ${operator} $${params.length}`;
    });
    return ` WHERE ${clauses.join(" AND ")}`;
  }

  orderSql() {
    if (this.orders.length === 0) return "";
    return ` ORDER BY ${this.orders
      .map((order) => `${ident(order.column)} ${order.ascending ? "ASC" : "DESC"}`)
      .join(", ")}`;
  }

  limitSql() {
    let clause = "";
    if (this.limitValue !== null) clause += ` LIMIT ${Number(this.limitValue)}`;
    if (this.offsetValue) clause += ` OFFSET ${Number(this.offsetValue)}`;
    return clause;
  }

  compile() {
    const params = [];
    const table = ident(this.table);
    const returning = ` RETURNING ${projection(this.columns)}`;

    if (this.mode === "select") {
      return {
        text: `SELECT ${projection(this.columns)} FROM ${table}${this.whereSql(
          params,
        )}${this.orderSql()}${this.limitSql()}`,
        params,
      };
    }

    if (this.mode === "insert" || this.mode === "upsert") {
      const row = this.payload?.[0] ?? {};
      const columns = Object.keys(row);
      if (columns.length === 0) {
        return { text: `INSERT INTO ${table} DEFAULT VALUES${returning}`, params };
      }
      const placeholders = columns.map((column, index) => {
        params.push(row[column]);
        return `$${index + 1}`;
      });
      let text = `INSERT INTO ${table} (${columns
        .map(ident)
        .join(", ")}) VALUES (${placeholders.join(", ")})`;
      if (this.mode === "upsert") {
        const conflictColumns = String(this.onConflict)
          .split(",")
          .map((column) => ident(column.trim()));
        const updates = columns
          .filter((column) => !conflictColumns.includes(ident(column)))
          .map((column) => `${ident(column)} = EXCLUDED.${ident(column)}`);
        text += ` ON CONFLICT (${conflictColumns.join(", ")})`;
        text += updates.length > 0 ? ` DO UPDATE SET ${updates.join(", ")}` : " DO NOTHING";
      }
      return { text: `${text}${returning}`, params };
    }

    if (this.mode === "update") {
      const columns = Object.keys(this.payload ?? {});
      const assignments = columns.map((column, index) => {
        params.push(this.payload[column]);
        return `${ident(column)} = $${index + 1}`;
      });
      return {
        text: `UPDATE ${table} SET ${assignments.join(", ")}${this.whereSql(
          params,
        )}${returning}`,
        params,
      };
    }

    if (this.mode === "delete") {
      return {
        text: `DELETE FROM ${table}${this.whereSql(params)}${returning}`,
        params,
      };
    }

    throw new Error(`Unsupported shim mode: ${this.mode}`);
  }

  async execute({ single, maybe }) {
    const { text, params } = this.compile();
    let rows;
    try {
      rows = await this.shim.run(text, params);
    } catch (error) {
      return {
        data: null,
        error: {
          code: error?.code ?? "XX000",
          message: error?.message ?? String(error),
          details: error?.detail ?? null,
          hint: error?.hint ?? null,
          constraint: error?.constraint_name ?? error?.constraint ?? null,
        },
      };
    }

    const normalized = toPostgrestRows(rows);
    if (!single) return { data: normalized, error: null };
    if (normalized.length === 1) return { data: normalized[0], error: null };
    if (normalized.length === 0 && maybe) return { data: null, error: null };
    return {
      data: null,
      error: {
        code: "PGRST116",
        message: "JSON object requested, multiple (or no) rows returned",
        details: null,
        hint: null,
        constraint: null,
      },
    };
  }
}

class PostgrestShim {
  constructor(sql, userId, clientId = null) {
    this.sql = sql;
    this.userId = userId;
    this.clientId = clientId;
  }
  from(table) {
    return new QueryBuilder(this, table);
  }
  run(text, params) {
    return this.sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL ROLE authenticated`);
      await tx.unsafe(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [
        this.userId,
      ]);
      await tx.unsafe(`SELECT set_config('request.jwt.claims', $1, true)`, [
        this.clientId ? JSON.stringify({ client_id: this.clientId }) : "{}",
      ]);
      return tx.unsafe(text, params);
    });
  }
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function createProofApp(sql) {
  const principals = new Map([
    [TOKEN_A, { userId: OWNER_A, clientId: null }],
    [TOKEN_B, { userId: OWNER_B, clientId: null }],
    [TOKEN_OAUTH_A, { userId: OWNER_A, clientId: "mcp-client" }],
  ]);
  const app = createApp({
    verifyToken: async (token) => principals.get(token)?.userId ?? null,
    createRequestClient: (token) => {
      const principal = principals.get(token) ?? { userId: null, clientId: null };
      return new PostgrestShim(sql, principal.userId, principal.clientId);
    },
    now: () => NOW,
  });

  async function request(method, path, token, body) {
    const headers = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await app.request(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    return { status: response.status, body: json };
  }

  return { request };
}

function baseExpense(overrides = {}) {
  return {
    occurredAt: "2026-11-07T09:30:00+01:00",
    amountMinor: 2250,
    category: "coffee",
    note: "morning coffee",
    merchant: "Cafe Atlas",
    needVsWant: "want",
    paymentMethod: "card",
    idempotencyKey: "api-key-1",
    ...overrides,
  };
}

async function main() {
  const { url } = parseArgs();
  const tags = await readJournal();
  assert(tags.includes(MIGRATION_TAG), `journal must include ${MIGRATION_TAG}`);

  const sql = postgres(url, { max: 10, onnotice: () => {} });
  try {
    await resetDatabase(sql);
    await applySupabaseShim(sql);

    let applied = 0;
    for (const tag of tags) {
      await applyFile(sql, tag);
      applied += 1;
    }
    await sql.unsafe(`GRANT USAGE ON SCHEMA public TO authenticated;`);
    await sql.unsafe(`GRANT SELECT ON TABLE public.user_time_context TO authenticated;`);
    log("MIGRATE", `${applied} journal migrations applied`);

    const { request } = createProofApp(sql);

    // AUTH ---------------------------------------------------------------------
    for (const [method, path] of [
      ["GET", "/api/expenses"],
      ["POST", "/api/expenses"],
      ["GET", "/api/expenses/00000000-0000-4000-8000-000000000001"],
      ["PATCH", "/api/expenses/00000000-0000-4000-8000-000000000001"],
      ["DELETE", "/api/expenses/00000000-0000-4000-8000-000000000001"],
    ]) {
      const response = await request(method, path, null, method === "GET" || method === "DELETE" ? undefined : {});
      assert(response.status === 401, `${method} ${path} must answer 401`);
      assert(response.body?.error?.code === "UNAUTHENTICATED", "401 envelope");
    }
    log("AUTH", "anonymous requests answer 401 before database access");

    // CREATE / GET / LIST ------------------------------------------------------
    const created = await request("POST", "/api/expenses", TOKEN_A, baseExpense());
    assert(created.status === 201, `create must answer 201, got ${created.status}`);
    assert(created.body?.ok === true, "create ok envelope");
    assert(created.body.replayed === false, "fresh create is not a replay");
    assert(created.body.expense?.amountMinor === 2250, "centimes are exact");
    assert(created.body.expense?.currency === "MAD", "currency is fixed MAD");
    assert(created.body.expense?.version === 1, "new row starts at version 1");
    const expenseId = created.body.expense.id;
    assert(typeof expenseId === "string" && expenseId.length === 36, "created id");

    const [durableCreate] = await sql.unsafe(
      `SELECT owner_user_id, amount_minor, currency, note, merchant, need_vs_want,
              payment_method, idempotency_key, version, deleted_at
       FROM public.personal_expenses WHERE id = $1::uuid`,
      [expenseId],
    );
    assert(durableCreate.owner_user_id === OWNER_A, "durable owner is the verified actor");
    assert(durableCreate.amount_minor === 2250, "durable amount is 2250 centimes");
    assert(durableCreate.currency === "MAD", "durable currency is MAD");
    assert(durableCreate.note === "morning coffee", "durable note");
    assert(durableCreate.need_vs_want === "want", "durable need/want");
    assert(durableCreate.payment_method === "card", "durable payment method");
    assert(durableCreate.idempotency_key === "api-key-1", "durable idempotency key");
    assert(durableCreate.deleted_at === null, "fresh row is active");
    log("CREATE", "201 + durable owner-scoped row with exact centimes");

    const longNote = "\"\\\n".repeat(167).slice(0, 500);
    const longMerchant = "\"\\".repeat(60);
    const longFingerprintCreate = await request("POST", "/api/expenses", TOKEN_A, {
      ...baseExpense({
        idempotencyKey: "api-long-fingerprint-1",
        amountMinor: 3300,
        note: longNote,
        merchant: longMerchant,
      }),
    });
    assert(
      longFingerprintCreate.status === 201,
      `quote/backslash max metadata must create, got ${longFingerprintCreate.status}`,
    );
    assert(
      longFingerprintCreate.body.expense.note === longNote,
      "long note round-trips unchanged",
    );
    const [longFingerprintRow] = await sql.unsafe(
      `SELECT create_fingerprint, note, merchant
       FROM public.personal_expenses
       WHERE owner_user_id = $1::uuid AND idempotency_key = 'api-long-fingerprint-1'`,
      [OWNER_A],
    );
    assert(longFingerprintRow, "long-metadata row persisted");
    assert(longFingerprintRow.note === longNote, "long note persisted");
    assert(longFingerprintRow.merchant === longMerchant, "long merchant persisted");
    assert(
      /^[0-9a-f]{64}$/.test(longFingerprintRow.create_fingerprint),
      `receipt is a 64-character SHA-256 hex hash, got ${longFingerprintRow.create_fingerprint}`,
    );
    await request("DELETE", `/api/expenses/${longFingerprintCreate.body.expense.id}`, TOKEN_A);
    log("CREATE", "max-length quote/backslash metadata hashes to a fixed 64-character receipt");

    const got = await request("GET", `/api/expenses/${expenseId}`, TOKEN_A);
    assert(got.status === 200, "owner get answers 200");
    assert(got.body.expense.id === expenseId, "get returns the same expense");

    const listed = await request("GET", "/api/expenses", TOKEN_A);
    assert(listed.status === 200, "owner list answers 200");
    assert(listed.body.expenses.some((entry) => entry.id === expenseId), "list includes the row");
    assert(listed.body.pagination.limit === 50, "default page limit is 50");
    log("READ", "get/list return the owner's row");

    // UPDATE / STALE VERSION ---------------------------------------------------
    const updated = await request("PATCH", `/api/expenses/${expenseId}`, TOKEN_A, {
      version: 1,
      amountMinor: 2400,
      note: "updated coffee",
    });
    assert(updated.status === 200, `update must answer 200, got ${updated.status}`);
    assert(updated.body.expense.version === 2, "update increments version");
    assert(updated.body.expense.amountMinor === 2400, "update persists the amount");
    assert(updated.body.expense.note === "updated coffee", "update persists the note");
    assert(
      !("createFingerprint" in updated.body.expense) &&
        !("create_fingerprint" in updated.body.expense),
      "the internal create fingerprint is never exposed on the wire",
    );

    const [afterEditSum] = await sql.unsafe(
      `SELECT coalesce(sum(amount_minor), 0)::int AS total
       FROM public.personal_expenses
       WHERE owner_user_id = $1::uuid AND deleted_at IS NULL`,
      [OWNER_A],
    );
    assert(afterEditSum.total === 2400, "active sum equals the edited amount exactly once");

    // A retry of the ORIGINAL create payload replays the current (edited) row.
    const replayOriginal = await request("POST", "/api/expenses", TOKEN_A, baseExpense());
    assert(replayOriginal.status === 200, "original payload after edit answers 200");
    assert(replayOriginal.body.replayed === true, "original payload after edit is a replay");
    assert(replayOriginal.body.expense.id === expenseId, "replay returns the same row");
    assert(replayOriginal.body.expense.amountMinor === 2400, "replay returns the edited row");
    assert(replayOriginal.body.expense.note === "updated coffee", "replay returns the edited note");

    // Retrying the edited values is NOT the original payload and must conflict.
    const replayEdited = await request("POST", "/api/expenses", TOKEN_A, {
      ...baseExpense(),
      amountMinor: 2400,
      note: "updated coffee",
    });
    assert(replayEdited.status === 409, "edited values cannot rewrite the original receipt");
    assert(replayEdited.body.error.code === "CONFLICT", "edited-values conflict envelope");

    const replayDifferent = await request("POST", "/api/expenses", TOKEN_A, {
      ...baseExpense(),
      amountMinor: 9999,
    });
    assert(replayDifferent.status === 409, "different payload remains a conflict");

    const stale = await request("PATCH", `/api/expenses/${expenseId}`, TOKEN_A, {
      version: 1,
      amountMinor: 9999,
    });
    assert(stale.status === 409, "stale version must answer 409");
    assert(stale.body.error.code === "CONFLICT", "stale version envelope");
    const [afterStale] = await sql.unsafe(
      `SELECT amount_minor, version FROM public.personal_expenses WHERE id = $1::uuid`,
      [expenseId],
    );
    assert(afterStale.amount_minor === 2400, "stale write did not overwrite the row");
    assert(Number(afterStale.version) === 2, "stale write did not bump the version");
    log("UPDATE", "optimistic version conflict leaves stored state intact");

    // SOFT DELETE --------------------------------------------------------------
    const deleted = await request("DELETE", `/api/expenses/${expenseId}`, TOKEN_A);
    assert(deleted.status === 200, "delete answers 200");
    assert(deleted.body.alreadyDeleted === false, "first delete is not a replay");
    assert(deleted.body.deletedAt === NOW.toISOString(), "delete uses the injected clock");

    const getDeleted = await request("GET", `/api/expenses/${expenseId}`, TOKEN_A);
    assert(getDeleted.status === 404, "soft-deleted row is not readable");
    const listedAfterDelete = await request("GET", "/api/expenses", TOKEN_A);
    assert(
      !listedAfterDelete.body.expenses.some((entry) => entry.id === expenseId),
      "soft-deleted row is excluded from list",
    );
    const [afterDeleteSum] = await sql.unsafe(
      `SELECT coalesce(sum(amount_minor), 0)::int AS total
       FROM public.personal_expenses
       WHERE owner_user_id = $1::uuid AND deleted_at IS NULL`,
      [OWNER_A],
    );
    assert(afterDeleteSum.total === 0, "active sum is zero after the only row is deleted");

    const repeatDelete = await request("DELETE", `/api/expenses/${expenseId}`, TOKEN_A);
    assert(repeatDelete.status === 200, "repeat delete answers 200");
    assert(repeatDelete.body.alreadyDeleted === true, "repeat delete is idempotent");
    assert(
      repeatDelete.body.deletedAt === deleted.body.deletedAt,
      "repeat delete keeps the original deletedAt",
    );
    const [durableDelete] = await sql.unsafe(
      `SELECT deleted_at, version FROM public.personal_expenses WHERE id = $1::uuid`,
      [expenseId],
    );
    assert(durableDelete.deleted_at instanceof Date, "soft-deleted row remains durable");
    assert(Number(durableDelete.version) === 3, "repeat delete does not bump version again");

    const replayPayload = baseExpense({
      idempotencyKey: "api-replay-deleted-1",
      amountMinor: 3210,
      note: "replay after delete",
      merchant: null,
      paymentMethod: null,
    });
    const replayCreated = await request("POST", "/api/expenses", TOKEN_A, replayPayload);
    assert(replayCreated.status === 201, "replay fixture created");
    const replayId = replayCreated.body.expense.id;
    const replayDeleted = await request("DELETE", `/api/expenses/${replayId}`, TOKEN_A);
    assert(replayDeleted.status === 200, "replay fixture deleted");
    const replayAgain = await request("POST", "/api/expenses", TOKEN_A, replayPayload);
    assert(replayAgain.status === 200, "same-key replay after soft delete answers 200");
    assert(replayAgain.body.replayed === true, "soft-deleted replay is flagged");
    assert(replayAgain.body.expense.id === replayId, "soft-deleted replay returns the prior row");
    assert(
      replayAgain.body.expense.deletedAt === replayDeleted.body.deletedAt,
      "soft-deleted replay exposes the existing deletedAt",
    );
    log("SOFT DELETE", "get/list exclude deletion; repeat delete is idempotent; replay keeps receipt");

    // CONCURRENT DELETE / DELETE ------------------------------------------------
    const deleteRaceBody = baseExpense({
      idempotencyKey: "api-concurrent-delete-1",
      amountMinor: 450,
      note: "delete race",
      merchant: null,
      paymentMethod: null,
    });
    const deleteRaceCreated = await request("POST", "/api/expenses", TOKEN_A, deleteRaceBody);
    assert(deleteRaceCreated.status === 201, "delete-race fixture created");
    const deleteRaceId = deleteRaceCreated.body.expense.id;
    const [deleteOne, deleteTwo] = await Promise.all([
      request("DELETE", `/api/expenses/${deleteRaceId}`, TOKEN_A),
      request("DELETE", `/api/expenses/${deleteRaceId}`, TOKEN_A),
    ]);
    assert(deleteOne.status === 200 && deleteTwo.status === 200, "both deletes answer 200");
    const deleteFlags = [deleteOne.body.alreadyDeleted, deleteTwo.body.alreadyDeleted].sort();
    assert(
      deleteFlags[0] === false && deleteFlags[1] === true,
      "exactly one concurrent delete performs the soft delete",
    );
    assert(
      deleteOne.body.deletedAt === deleteTwo.body.deletedAt,
      "concurrent deletes share one deletedAt",
    );
    const [deleteRaceRow] = await sql.unsafe(
      `SELECT deleted_at, version FROM public.personal_expenses WHERE id = $1::uuid`,
      [deleteRaceId],
    );
    assert(deleteRaceRow.deleted_at instanceof Date, "delete-race row remains durable");
    assert(Number(deleteRaceRow.version) === 2, "concurrent delete bumps version exactly once");
    const [deleteRaceSum] = await sql.unsafe(
      `SELECT coalesce(sum(amount_minor), 0)::int AS total
       FROM public.personal_expenses
       WHERE owner_user_id = $1::uuid AND deleted_at IS NULL`,
      [OWNER_A],
    );
    assert(deleteRaceSum.total === 0, "concurrent delete leaves no active amount");
    log("SOFT DELETE", "concurrent delete/delete bumps version once and leaves totals unchanged");

    // CONCURRENT DOUBLE SUBMIT -------------------------------------------------
    const concurrentBody = baseExpense({
      idempotencyKey: "api-concurrent-1",
      amountMinor: 1111,
      note: "concurrent",
    });
    const [first, second] = await Promise.all([
      request("POST", "/api/expenses", TOKEN_A, concurrentBody),
      request("POST", "/api/expenses", TOKEN_A, concurrentBody),
    ]);
    const statuses = [first.status, second.status].sort((a, b) => a - b);
    assert(
      statuses[0] === 200 && statuses[1] === 201,
      `concurrent submit must answer 200+201, got ${statuses.join(",")}`,
    );
    const replayFlags = [first.body.replayed, second.body.replayed].sort();
    assert(
      replayFlags[0] === false && replayFlags[1] === true,
      "exactly one concurrent submit is a fresh create",
    );
    assert(first.body.expense.id === second.body.expense.id, "both submits return the same row");
    const [concurrentCount] = await sql.unsafe(
      `SELECT count(*)::int AS count FROM public.personal_expenses
       WHERE owner_user_id = $1::uuid AND idempotency_key = 'api-concurrent-1'`,
      [OWNER_A],
    );
    assert(concurrentCount.count === 1, "concurrent double submit creates exactly one row");
    log("IDEMPOTENCY", "concurrent double submit creates exactly one row");

    const conflicting = await request("POST", "/api/expenses", TOKEN_A, {
      ...concurrentBody,
      amountMinor: 2222,
    });
    assert(conflicting.status === 409, "same key with a different payload answers 409");
    assert(conflicting.body.error.code === "CONFLICT", "conflict envelope");
    const [conflictCount] = await sql.unsafe(
      `SELECT count(*)::int AS count FROM public.personal_expenses
       WHERE owner_user_id = $1::uuid AND idempotency_key = 'api-concurrent-1'`,
      [OWNER_A],
    );
    assert(conflictCount.count === 1, "conflicting retry creates no extra row");
    log("IDEMPOTENCY", "same key with a conflicting payload answers 409");

    // MONEY VALIDATION ---------------------------------------------------------
    for (const [index, amount] of [0, -5, 22.5, 2147483648, "2250"].entries()) {
      const response = await request(
        "POST",
        "/api/expenses",
        TOKEN_A,
        baseExpense({ idempotencyKey: `invalid-amount-${index}`, amountMinor: amount }),
      );
      assert(response.status === 400, `amount ${String(amount)} must answer 400`);
      assert(response.body.error.code === "VALIDATION", "invalid amount envelope");
    }
    for (const [index, occurredAt] of [
      "2026-02-30T10:00:00Z",
      "2026-04-31T10:00:00Z",
      "2026-11-07T24:00:00Z",
      "2026-11-07T23:60:00Z",
      "2026-11-07T10:00:00+24:00",
    ].entries()) {
      const response = await request(
        "POST",
        "/api/expenses",
        TOKEN_A,
        baseExpense({ idempotencyKey: `invalid-date-${index}`, occurredAt }),
      );
      assert(response.status === 400, `occurredAt ${occurredAt} must answer 400`);
      assert(response.body.error.code === "VALIDATION", "invalid date envelope");
    }
    for (const [index, field] of ["note", "merchant", "idempotencyKey"].entries()) {
      const response = await request(
        "POST",
        "/api/expenses",
        TOKEN_A,
        baseExpense({ idempotencyKey: `invalid-char-${index}`, [field]: "bad\u0000value" }),
      );
      assert(response.status === 400, `NUL in ${field} must answer 400`);
      assert(response.body.error.code === "VALIDATION", "NUL envelope");
    }
    const unpaired = await request(
      "POST",
      "/api/expenses",
      TOKEN_A,
      baseExpense({ idempotencyKey: "invalid-surrogate", note: "bad\ud800value" }),
    );
    assert(unpaired.status === 400, "unpaired surrogate must answer 400");
    assert(unpaired.body.error.code === "VALIDATION", "surrogate envelope");

    const unknownOwner = await request("POST", "/api/expenses", TOKEN_A, {
      ...baseExpense({ idempotencyKey: "invalid-owner" }),
      ownerUserId: OWNER_B,
    });
    assert(unknownOwner.status === 400, "caller-supplied owner id must answer 400");
    const invalidCategory = await request("POST", "/api/expenses", TOKEN_A, {
      ...baseExpense({ idempotencyKey: "invalid-category" }),
      category: "rent",
    });
    assert(invalidCategory.status === 400, "invalid category must answer 400");
    const [invalidRows] = await sql.unsafe(
      `SELECT count(*)::int AS count FROM public.personal_expenses
       WHERE idempotency_key LIKE 'invalid-%'`,
    );
    assert(invalidRows.count === 0, "rejected payloads leave no durable rows");
    log("VALIDATION", "zero/negative/fractional/overflow/string amounts and unknown keys answer 400");

    // OWNER ISOLATION ----------------------------------------------------------
    const [activeA] = await sql.unsafe(
      `SELECT id FROM public.personal_expenses
       WHERE owner_user_id = $1::uuid AND deleted_at IS NULL
       ORDER BY occurred_at DESC LIMIT 1`,
      [OWNER_A],
    );
    const otherGet = await request("GET", `/api/expenses/${activeA.id}`, TOKEN_B);
    assert(otherGet.status === 404, "owner B cannot read owner A's expense");
    const otherPatch = await request("PATCH", `/api/expenses/${activeA.id}`, TOKEN_B, {
      version: 1,
      amountMinor: 1,
    });
    assert(otherPatch.status === 404, "owner B cannot patch owner A's expense");
    const otherDelete = await request("DELETE", `/api/expenses/${activeA.id}`, TOKEN_B);
    assert(otherDelete.status === 404, "owner B cannot delete owner A's expense");
    const bList = await request("GET", "/api/expenses", TOKEN_B);
    assert(bList.status === 200, "owner B list answers 200");
    assert(bList.body.expenses.length === 0, "owner B sees an empty list");

    const sameKeyB = await request(
      "POST",
      "/api/expenses",
      TOKEN_B,
      baseExpense({ idempotencyKey: "api-key-1", amountMinor: 777 }),
    );
    assert(sameKeyB.status === 201, "owner B may reuse owner A's idempotency key");
    const [crossOwnerKeys] = await sql.unsafe(
      `SELECT count(*)::int AS count FROM public.personal_expenses
       WHERE idempotency_key = 'api-key-1'`,
    );
    assert(crossOwnerKeys.count === 2, "same key is scoped per owner");
    log("RLS", "cross-owner get/patch/delete answer 404 and keys are owner-scoped");

    // OAUTH / CLIENT_ID CLAIM --------------------------------------------------
    const oauthCreate = await request(
      "POST",
      "/api/expenses",
      TOKEN_OAUTH_A,
      baseExpense({ idempotencyKey: "oauth-insert", amountMinor: 555 }),
    );
    assert(oauthCreate.status === 403, "client_id token insert answers 403");
    assert(oauthCreate.body.error.code === "FORBIDDEN", "client_id insert envelope");
    const [oauthRows] = await sql.unsafe(
      `SELECT count(*)::int AS count FROM public.personal_expenses
       WHERE idempotency_key = 'oauth-insert'`,
    );
    assert(oauthRows.count === 0, "client_id insert leaves no row");

    const oauthGet = await request("GET", `/api/expenses/${activeA.id}`, TOKEN_OAUTH_A);
    assert(oauthGet.status === 404, "client_id token cannot read another owner's row");
    const oauthList = await request("GET", "/api/expenses", TOKEN_OAUTH_A);
    assert(oauthList.status === 200, "client_id list answers 200 with no rows");
    assert(oauthList.body.expenses.length === 0, "client_id token sees no expenses");
    log("RLS", "client_id claim insert is 403 and reads are empty/404");

    // DST / TIMEZONE WINDOWS ---------------------------------------------------
    const dstRows = [
      { occurredAt: "2026-03-08T04:59:59.999Z", key: "api-dst-before" },
      { occurredAt: "2026-03-08T05:00:00.000Z", key: "api-dst-start" },
      { occurredAt: "2026-03-08T12:00:00.000Z", key: "api-dst-inside" },
      { occurredAt: "2026-03-09T04:00:00.000Z", key: "api-dst-end" },
    ];
    for (const row of dstRows) {
      const response = await request(
        "POST",
        "/api/expenses",
        TOKEN_A,
        baseExpense({
          occurredAt: row.occurredAt,
          idempotencyKey: row.key,
          amountMinor: 100,
          note: null,
          merchant: null,
          paymentMethod: null,
        }),
      );
      assert(response.status === 201, `DST row ${row.key} created`);
    }

    const nyFromQuery = await request(
      "GET",
      "/api/expenses?from=2026-03-08&to=2026-03-08&timezone=America/New_York&limit=100",
      TOKEN_A,
    );
    assert(nyFromQuery.status === 200, "explicit timezone list answers 200");
    const nyKeys = nyFromQuery.body.expenses.map((entry) => entry.idempotencyKey);
    assert(
      nyKeys.includes("api-dst-start") && nyKeys.includes("api-dst-inside"),
      "explicit NY window includes start/inside",
    );
    assert(
      !nyKeys.includes("api-dst-before") && !nyKeys.includes("api-dst-end"),
      "half-open explicit NY window excludes before/end",
    );

    // Owner time-context fallback: store NY and omit the query timezone.
    await sql.unsafe(
      `INSERT INTO public.user_time_context (user_id, iana_timezone)
       VALUES ($1::uuid, 'America/New_York')
       ON CONFLICT (user_id) DO UPDATE SET iana_timezone = EXCLUDED.iana_timezone`,
      [OWNER_A],
    );
    const ownerTimeContext = await request(
      "GET",
      "/api/expenses?from=2026-03-08&to=2026-03-08&limit=100",
      TOKEN_A,
    );
    assert(ownerTimeContext.status === 200, "owner time-context list answers 200");
    const ownerKeys = ownerTimeContext.body.expenses.map((entry) => entry.idempotencyKey);
    assert(ownerKeys.length === nyKeys.length, "owner timezone matches explicit NY window");
    assert(ownerKeys.includes("api-dst-start"), "owner timezone includes the DST start instant");
    log("TIME WINDOW", "explicit IANA and owner time-context DST windows are half-open");

    const invalidTimezone = await request(
      "GET",
      "/api/expenses?from=2026-03-08&timezone=Mars/Olympus",
      TOKEN_A,
    );
    assert(invalidTimezone.status === 400, "invalid IANA timezone answers 400");

    // PAGINATION ---------------------------------------------------------------
    const pageRows = [
      { occurredAt: "2026-10-05T00:00:00Z", key: "api-page-5", amount: 500 },
      { occurredAt: "2026-10-04T00:00:00Z", key: "api-page-4", amount: 400 },
      { occurredAt: "2026-10-03T00:00:00Z", key: "api-page-3", amount: 300 },
      { occurredAt: "2026-10-02T00:00:00Z", key: "api-page-2", amount: 200 },
      { occurredAt: "2026-10-01T00:00:00Z", key: "api-page-1", amount: 100 },
    ];
    for (const row of pageRows) {
      const response = await request(
        "POST",
        "/api/expenses",
        TOKEN_A,
        baseExpense({
          occurredAt: row.occurredAt,
          idempotencyKey: row.key,
          amountMinor: row.amount,
          note: null,
          merchant: null,
          paymentMethod: null,
        }),
      );
      assert(response.status === 201, `page row ${row.key} created`);
    }

    const firstPage = await request(
      "GET",
      "/api/expenses?from=2026-10-01&to=2026-10-05&timezone=UTC&limit=2&offset=1",
      TOKEN_A,
    );
    assert(firstPage.status === 200, "paginated list answers 200");
    assert(
      firstPage.body.expenses.map((entry) => entry.idempotencyKey).join(",") ===
        "api-page-4,api-page-3",
      "pagination follows occurred_at desc, id desc",
    );
    assert(firstPage.body.pagination.hasMore === true, "hasMore is true with more rows");

    const lastPage = await request(
      "GET",
      "/api/expenses?from=2026-10-01&to=2026-10-05&timezone=UTC&limit=2&offset=4",
      TOKEN_A,
    );
    assert(lastPage.body.expenses.length === 1, "last page is bounded");
    assert(lastPage.body.pagination.hasMore === false, "hasMore is false on the last page");
    log("PAGINATION", "ordered, bounded pages with exact hasMore");

    // Invalid pagination/query keys -------------------------------------------
    for (const query of ["limit=0", "limit=101", "offset=-1", "ownerUserId=attacker"]) {
      const response = await request("GET", `/api/expenses?${query}`, TOKEN_A);
      assert(response.status === 400, `${query} must answer 400`);
    }

    log(
      "PROOF",
      "real Hono + Postgres expense CRUD, idempotency, validation, owner isolation, DST windows, pagination and soft delete verified",
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error);
  exit(1);
});
