#!/usr/bin/env node
/**
 * Disposable PostgreSQL proof for MONEY-001-A F04: period continuity.
 *
 * Scenario (all dates anchored to the database clock):
 *   - one tracking period with a known opening and explicit day-start setup;
 *   - a routine booking after its window continues the calendar through the one
 *     controlled RPC: the source becomes `superseded` with no finalization
 *     reference, close row, successor link or opening, and exactly one later
 *     tracking period owns the booking;
 *   - a retry and two concurrent routine writes converge on the same successor;
 *   - a future booking date cannot continue the window, and the internal
 *     continuation RPC is not executable by authenticated callers directly;
 *   - an unknown-opening superseded predecessor is initialized exactly once,
 *     keeps its `continuedFrom` provenance, and can then be finalized; active
 *     dates and settings stay closed;
 *   - a legacy out-of-period row is reported by the migration preflight, an
 *     in-range correction succeeds, and a soft delete still succeeds;
 *   - a gap larger than 366 days is refused instead of creating empty periods;
 *   - a booking before the window or inside a finalized period is refused;
 *   - a non-finalized superseded period accepts routine entry for its own dates;
 *   - a failed routine insert rolls the continuation back atomically;
 *   - finalizing a continuation successor before its predecessor is blocked, and
 *     a tracking or superseded source that still owns today cannot finalize in
 *     either opening mode;
 *   - direct lifecycle writes cannot enter or leave `superseded`, and a
 *     read-only grant or another owner cannot call the RPC;
 *   - explicit rollover adopts the exact continued successor, establishes its
 *     opening once, preserves its recorded movements and links/receipts the
 *     source; a different range or opening is a conflict, an existing opening
 *     with the same amount is retained once, and a forged provenance pointer
 *     never selects a non-adjacent period.
 */
import { readFile } from "node:fs/promises";
import { argv, exit } from "node:process";
import postgres from "postgres";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const D = "44444444-4444-4444-8444-444444444444";
const E = "55555555-5555-4555-8555-555555555555";
const F = "66666666-6666-4666-8666-666666666666";
const G = "77777777-7777-4777-8777-777777777777";
const H = "88888888-8888-4888-8888-888888888888";
const I = "99999999-9999-4999-8999-999999999999";
const J = "aaaaaaaa-9999-4999-8999-999999999999";
const K = "bbbbbbbb-9999-4999-8999-999999999999";
const L = "cccccccc-9999-4999-8999-999999999999";
const M = "dddddddd-9999-4999-8999-999999999999";
const N = "eeeeeeee-9999-4999-8999-999999999999";
const O = "ffffffff-9999-4999-8999-999999999999";
const P = "12121212-9999-4999-8999-999999999999";
const RESOURCE = "https://ega.example.com/api/mcp";
const READ = ["today.read", "timer.read", "personal_ops.read"];
const WRITE = [...READ, "personal_ops.write"];

const tags = JSON.parse(
  await readFile(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8"),
).entries.map((entry) => entry.tag);
const url = argv[argv.indexOf("--url") + 1];
if (!url) throw new Error("Missing --url");

const sql = postgres(url, {
  max: 4,
  onnotice: () => {},
  types: {
    date: { to: 1082, from: [1082], serialize: (value) => value, parse: (value) => value },
  },
});

function assert(ok, message) {
  if (!ok) throw new Error(message);
}
function hex(char) {
  return char.repeat(64);
}
function addDays(iso, days) {
  const value = new Date(`${iso}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function endOfMonth(iso) {
  const [year, month] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

async function user(owner, fn, clientId = null) {
  return sql.begin(async (tx) => {
    await tx.unsafe("SET LOCAL ROLE authenticated");
    await tx.unsafe("SELECT set_config('request.jwt.claim.sub', $1, true)", [owner]);
    await tx.unsafe("SELECT set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({
        sub: owner,
        role: "authenticated",
        aud: clientId ? RESOURCE : "authenticated",
        ...(clientId ? { client_id: clientId } : {}),
      }),
    ]);
    return fn(tx);
  });
}

async function waitForLockWait(applicationName, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await sql.unsafe(
      "SELECT count(*)::int n FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'",
      [applicationName],
    );
    if (rows[0].n > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${applicationName} to block on a row lock.`);
}

async function beginAs(owner, applicationName, fn) {
  return sql.begin(async (tx) => {
    await tx.unsafe("SET LOCAL ROLE authenticated");
    await tx.unsafe("SELECT set_config('application_name', $1, true)", [applicationName]);
    await tx.unsafe("SELECT set_config('request.jwt.claim.sub', $1, true)", [owner]);
    await tx.unsafe("SELECT set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({
        sub: owner,
        role: "authenticated",
        aud: "authenticated",
      }),
    ]);
    return fn(tx);
  });
}

const createPeriod = (
  tx,
  start,
  end,
  active,
  opening,
  provenance = opening === null
    ? { opening: null, createdFrom: "web" }
    : {
        opening: {
          source: "user_entered",
          recordedAt: `${start}T00:00:00.000Z`,
          cutoffDate: start,
          evidence: null,
          note: null,
          corrections: [],
        },
        createdFrom: "web",
      },
  initialization = opening === null ? "uninitialized" : "initialized",
  settings = { savingsTargetMinor: null, emergencyTargetMinor: null },
) =>
  tx.unsafe(
    `SELECT (p).id, (p).version, (p).lifecycle
     FROM (SELECT public.money_create_period(
       $1::date, $2::date, 'Africa/Casablanca'::text, $3::date,
       $7::text, $4::integer, $1::date, $5::text, $6::jsonb,
       $8::jsonb, now()::timestamptz
     ) AS p) created`,
    [start, end, active, opening, hex("a"), provenance, initialization, settings],
  );

const continuePeriod = (tx, bookingDate) =>
  tx.unsafe("SELECT * FROM public.money_continue_period($1::date)", [bookingDate]);

const recordRoutine = (
  tx,
  {
    bookingDate,
    kind = "expense",
    direction = "out",
    occurredAt = null,
    amountMinor = 1250,
    category = "coffee",
    note = null,
    merchant = null,
    needVsWant = "want",
    paymentMethod = null,
    purpose = "flexible",
    countsInDaily = true,
    idempotencyKey,
    fingerprint = hex("f"),
  },
) =>
  tx.unsafe(
    `SELECT * FROM public.money_record_routine_movement(
      $1::date, $2::text, $3::text, $4::timestamptz, $5::integer,
      $6::text, $7::text, $8::text, $9::text, $10::text, $11::text,
      $12::boolean, $13::text, $14::text
    )`,
    [
      bookingDate,
      kind,
      direction,
      occurredAt,
      amountMinor,
      category,
      note,
      merchant,
      needVsWant,
      paymentMethod,
      purpose,
      countsInDaily,
      idempotencyKey,
      fingerprint,
    ],
  );

async function main() {
  try {
    await sql.unsafe(
      "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS auth CASCADE; DROP SCHEMA IF EXISTS automation CASCADE; CREATE SCHEMA public;",
    );
    await sql.unsafe(`DO $x$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='supabase_auth_admin') THEN CREATE ROLE supabase_auth_admin NOLOGIN; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
    END $x$`);
    await sql.unsafe("CREATE SCHEMA auth");
    await sql.unsafe("GRANT USAGE ON SCHEMA public, auth TO anon, authenticated");
    await sql.unsafe("CREATE TABLE auth.users (id uuid PRIMARY KEY, email text NOT NULL)");
    await sql.unsafe(
      "INSERT INTO auth.users VALUES ($1,'a@example.test'),($2,'b@example.test'),($3,'c@example.test'),($4,'d@example.test'),($5,'e@example.test'),($6,'f@example.test'),($7,'g@example.test'),($8,'h@example.test'),($9,'i@example.test'),($10,'j@example.test'),($11,'k@example.test'),($12,'l@example.test'),($13,'m@example.test'),($14,'n@example.test'),($15,'o@example.test'),($16,'p@example.test')",
      [A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P],
    );
    await sql.unsafe("UPDATE auth.users SET email='ab.mortaki@gmail.com' WHERE id=$1", [A]);
    await sql.unsafe(
      "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$",
    );
    await sql.unsafe(
      "CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$",
    );
    await sql.unsafe("CREATE SCHEMA automation");
    await sql.unsafe(
      "CREATE TABLE automation.implementation_runs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id varchar(64), linear_issue_id varchar(64), linear_issue_identifier varchar(64), linear_issue_url text, attempt_number integer NOT NULL DEFAULT 1, status varchar(48) NOT NULL DEFAULT 'queued', claimed_by varchar(64), heartbeat_at timestamptz, lease_expires_at timestamptz, started_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), finished_at timestamptz, failure_code varchar(64), pr_number bigint, created_at timestamptz DEFAULT now())",
    );
    for (const tag of tags) {
      const text = await readFile(new URL(`../../drizzle/${tag}.sql`, import.meta.url), "utf8");
      for (const statement of text
        .split("--> statement-breakpoint")
        .map((part) => part.trim())
        .filter(Boolean)) {
        await sql.unsafe(statement);
      }
    }
    console.log(`[MIGRATE] ${tags.length} migrations through ${tags.at(-1)}`);

    for (const [clientId, profile, permissions, owner] of [
      ["money-read", "personal_operations", READ, A],
      ["money-write", "personal_operations_writer", WRITE, A],
    ]) {
      await sql`INSERT INTO public.mcp_authorization_grants
        (owner_user_id,oauth_client_id,resource_uri,client_name,status,permission_profile,permissions,permissions_version,approved_at)
        VALUES (${owner}::uuid,${clientId},${RESOURCE},'proof','active',${profile},${sql.json(permissions)},1,now())`;
    }

    const clock = await sql.unsafe(
      "SELECT (now() AT TIME ZONE 'Africa/Casablanca')::date AS today",
    );
    const today = clock[0].today;
    const sourceStart = addDays(today, -40);
    const sourceEnd = addDays(today, -11);
    const expectedStart = addDays(sourceEnd, 1);
    const expectedEnd = endOfMonth(today);

    // --- Owner A: the canonical continuation and adoption -------------------
    const created = await user(A, (tx) => createPeriod(tx, sourceStart, sourceEnd, sourceStart, 100000));
    const sourceId = created[0].id;
    let sourceVersion = created[0].version;
    const sourceProvenance = await sql.unsafe(
      "SELECT provenance #>> '{opening,source}' AS source, initialization FROM public.money_periods WHERE id=$1",
      [sourceId],
    );
    assert(
      sourceProvenance[0].source === "user_entered" &&
        sourceProvenance[0].initialization === "initialized",
      "the fixture creates an initialized period with real opening provenance",
    );
    await user(A, (tx) =>
      tx.unsafe("SELECT public.money_rebase_day_start_baseline($1::uuid)", [sourceId]),
    );
    await user(A, (tx) =>
      tx.unsafe(
        `INSERT INTO public.personal_expenses
         (owner_user_id,period_id,booking_date,kind,direction,amount_minor,currency,
          category,need_vs_want,purpose,counts_in_daily,idempotency_key,create_fingerprint)
         VALUES ($1,$2,$3::date,'expense','out',1250,'MAD',
          'coffee','want','flexible',true,'money-f04-source-expense',repeat('b',64))`,
        [A, sourceId, sourceEnd],
      ),
    );

    // The only reachable continuation path is the atomic routine RPC. A direct
    // money_continue_period call is not granted to authenticated callers.
    const continued = await user(A, (tx) =>
      recordRoutine(tx, {
        bookingDate: today,
        amountMinor: 1500,
        category: "groceries",
        needVsWant: "need",
        idempotencyKey: "money-f04-first-continuation",
        fingerprint: hex("a"),
      }),
    );
    const successorPeriods = await sql.unsafe(
      `SELECT * FROM public.money_periods
       WHERE owner_user_id=$1 AND lifecycle='tracking'`,
      [A],
    );
    assert(successorPeriods.length === 1, "continuation leaves exactly one tracking period");
    const successor = successorPeriods[0];
    assert(
      continued[0].period_id === successor.id,
      "the routine movement lands in the continuation successor",
    );
    assert(
      successor.lifecycle === "tracking" &&
        successor.start_date === expectedStart &&
        successor.end_date === expectedEnd &&
        successor.active_date === today,
      "continuation creates the smallest contiguous successor containing the booking date",
    );
    assert(
      successor.initialization === "uninitialized" &&
        successor.opening_movement_id === null &&
        successor.day_start_setup_completed === false,
      "the continued successor starts with an unknown opening and incomplete setup",
    );
    assert(
      successor.provenance?.continuedFrom === sourceId &&
        successor.provenance?.opening === null,
      "the successor records descriptive continuation provenance without an opening",
    );
    const source = (
      await sql.unsafe(
        "SELECT lifecycle, successor_period_id, finalization_reference, rolled_over_at FROM public.money_periods WHERE id=$1",
        [sourceId],
      )
    )[0];
    assert(
      source.lifecycle === "superseded" &&
        source.successor_period_id === null &&
        source.finalization_reference === null &&
        source.rolled_over_at === null,
      "the superseded source carries no finalization evidence",
    );
    const invented = await sql.unsafe(
      `SELECT
        (SELECT count(*)::int FROM public.money_day_closes WHERE owner_user_id=$1 AND period_id=$2) AS closes,
        (SELECT count(*)::int FROM public.personal_expenses WHERE owner_user_id=$1 AND period_id=$3 AND kind='opening') AS openings,
        (SELECT count(*)::int FROM public.money_periods WHERE owner_user_id=$1) AS periods`,
      [A, sourceId, successor.id],
    );
    assert(
      invented[0].closes === 0 && invented[0].openings === 0 && invented[0].periods === 2,
      "continuation invents no close, opening or extra period",
    );
    const continuedBaseline = await sql.unsafe(
      `SELECT availability, unavailable_reason, date
       FROM public.money_day_start_baselines
       WHERE owner_user_id=$1 AND period_id=$2
       ORDER BY version DESC LIMIT 1`,
      [A, successor.id],
    );
    assert(
      continuedBaseline.length === 1 &&
        continuedBaseline[0].availability === "unavailable" &&
        continuedBaseline[0].unavailable_reason === "initial_setup_incomplete" &&
        continuedBaseline[0].date === today,
      "the canonical baseline path records an explicit incomplete setup at the active date",
    );
    sourceVersion = (
      await sql.unsafe("SELECT version FROM public.money_periods WHERE id=$1", [sourceId])
    )[0].version;
    console.log("[CONTINUE] a later routine booking supersedes the window and creates one unknown-opening successor");

    // Same date, including on a month end. A retry must never create a second
    // successor because today + 1 can fall outside the continued month.
    const retry = await user(A, (tx) =>
      recordRoutine(tx, {
        bookingDate: today,
        amountMinor: 1600,
        category: "household",
        needVsWant: "need",
        idempotencyKey: "money-f04-continuation-retry",
        fingerprint: hex("b"),
      }),
    );
    assert(
      retry[0].period_id === successor.id,
      "a retry inside the continued window stays in the same period",
    );
    const periodCountAfterRetry = await sql.unsafe(
      "SELECT count(*)::int n FROM public.money_periods WHERE owner_user_id=$1",
      [A],
    );
    assert(periodCountAfterRetry[0].n === 2, "the retry creates no second successor");

    // A future date must not supersede the current window, even through the
    // atomic routine RPC. Only owner-local today or earlier may continue.
    let futureContinuationDenied = false;
    try {
      await user(A, (tx) =>
        recordRoutine(tx, {
          bookingDate: addDays(expectedEnd, 1),
          amountMinor: 1700,
          category: "coffee",
          idempotencyKey: "money-f04-future-continuation",
          fingerprint: hex("c"),
        }),
      );
    } catch (error) {
      futureContinuationDenied =
        error.code === "23514" && /in the future/.test(error.message);
    }
    assert(
      futureContinuationDenied,
      "a future booking date cannot continue the tracking window",
    );
    const afterFuture = await sql.unsafe(
      `SELECT count(*)::int n,
              count(*) FILTER (WHERE lifecycle='tracking')::int tracking
       FROM public.money_periods WHERE owner_user_id=$1`,
      [A],
    );
    assert(
      afterFuture[0].n === 2 && afterFuture[0].tracking === 1,
      "the refused future continuation leaves the calendar unchanged",
    );

    // The continued period contains a real movement before finalization. The
    // atomic routine RPC owns both the period resolution and the insert.
    const successorMovement = await user(A, (tx) =>
      recordRoutine(tx, {
        bookingDate: today,
        amountMinor: 2000,
        category: "groceries",
        needVsWant: "need",
        idempotencyKey: "money-f04-successor-expense",
        fingerprint: hex("c"),
      }),
    );
    assert(
      successorMovement[0].period_id === successor.id &&
        successorMovement[0].booking_date === today,
      "the atomic routine write stores the resolved successor period",
    );

    // A direct cross-window date edit cannot leave a stale period reference,
    // even when it bypasses the application guard.
    let staleCrossWindowDenied = false;
    try {
      await user(A, (tx) =>
        tx.unsafe(
          `UPDATE public.personal_expenses
           SET booking_date = $1::date, version = version + 1, updated_at = now()
           WHERE id = $2`,
          [addDays(sourceStart, 10), successorMovement[0].id],
        ),
      );
    } catch (error) {
      staleCrossWindowDenied = error.code === "23514";
    }
    assert(
      staleCrossWindowDenied,
      "a direct cross-window date edit is rejected by the period/date guard",
    );
    const unchangedMovement = (
      await sql.unsafe(
        "SELECT booking_date, period_id FROM public.personal_expenses WHERE id=$1",
        [successorMovement[0].id],
      )
    )[0];
    assert(
      unchangedMovement.booking_date === today &&
        unchangedMovement.period_id === successor.id,
      "the rejected cross-window edit leaves booking date and period unchanged",
    );

    // A forgotten date inside the now-superseded source is still routine entry
    // for that non-finalized period's own range. It must not move forward.
    const backfill = await user(A, (tx) =>
      recordRoutine(tx, {
        bookingDate: addDays(sourceStart, 10),
        amountMinor: 1750,
        category: "household",
        needVsWant: "need",
        idempotencyKey: "money-f04-source-backfill",
        fingerprint: hex("b"),
      }),
    );
    assert(
      backfill[0].period_id === sourceId,
      "a non-finalized superseded period accepts routine entry for its own dates",
    );
    const sourceAfterBackfill = (
      await sql.unsafe(
        "SELECT lifecycle, successor_period_id FROM public.money_periods WHERE id=$1",
        [sourceId],
      )
    )[0];
    assert(
      sourceAfterBackfill.lifecycle === "superseded" &&
        sourceAfterBackfill.successor_period_id === null,
      "the backfill does not finalize or supersede the period",
    );

    // A date before the continued window and a date inside an already finalized
    // range are historical corrections.
    let beforeDenied = false;
    try {
      await user(A, (tx) =>
        recordRoutine(tx, {
          bookingDate: addDays(sourceStart, -1),
          amountMinor: 1800,
          idempotencyKey: "money-f04-before-window",
          fingerprint: hex("d"),
        }),
      );
    } catch (error) {
      beforeDenied = error.code === "23514";
    }
    assert(beforeDenied, "a date before the tracking window is refused");

    // The continuation RPC itself is internal: authenticated callers cannot
    // invoke it directly, so a superseded window cannot be left without the
    // movement that required it.
    let directContinuationDenied = false;
    try {
      await user(A, (tx) => continuePeriod(tx, today));
    } catch (error) {
      directContinuationDenied = error.code === "42501";
    }
    assert(
      directContinuationDenied,
      "authenticated callers cannot execute money_continue_period directly",
    );
    const internalGrant = await sql.unsafe(
      `SELECT
         has_function_privilege('authenticated','public.money_continue_period(date)','EXECUTE') AS authenticated_execute,
         has_function_privilege('authenticated','public.money_record_routine_movement(date,text,text,timestamptz,integer,text,text,text,text,text,text,boolean,text,text)','EXECUTE') AS routine_execute`,
    );
    assert(
      internalGrant[0].authenticated_execute === false &&
        internalGrant[0].routine_execute === true,
      "continuation is reachable only through the atomic routine function",
    );

    // The lifecycle guard itself (not only the grant) keeps `superseded` out of
    // the approved `ended` meaning.
    let supersededToEndedDenied = false;
    try {
      await sql.unsafe(
        "UPDATE public.money_periods SET lifecycle='ended', version=version+1, updated_at=now() WHERE id=$1",
        [sourceId],
      );
    } catch (error) {
      supersededToEndedDenied = error.code === "23514";
    }
    assert(supersededToEndedDenied, "superseded cannot become an approved ended period");

    // --- Adoption by exact range, then duplicate/opening conflicts ----------
    const modeledClosing = 100000 - 1250 - 1750;
    const rolloverArgs = (start, end, amount, operationId, mode = "carry_forward") => [
      sourceId,
      sourceVersion,
      start,
      end,
      start,
      "Africa/Casablanca",
      mode === "carry_forward" ? "initialized" : "reconciled",
      false,
      amount,
      sourceEnd,
      mode === "verified_source" ? "Verified bank balance" : null,
      "Finalized after review",
      hex("d"),
      {
        opening: {
          source: mode,
          recordedAt: `${start}T09:00:00.000Z`,
          cutoffDate: sourceEnd,
          evidence: mode === "verified_source" ? "Verified bank balance" : null,
          note: "Finalized after review",
          corrections: [],
        },
        createdFrom: "web",
      },
      null,
      operationId,
      hex("e"),
      mode,
      null,
      null,
      null,
      "Reviewed every unverified day",
      30,
      { modeledClosingCashMinor: modeledClosing, pendingOccurrenceCount: 0 },
      [],
      [],
      `${start}T09:00:00.000Z`,
    ];
    const callRollover = (tx, args) =>
      tx.unsafe(
        `SELECT public.money_rollover_period(
          $1::uuid,$2::integer,$3::date,$4::date,$5::date,$6::text,$7::text,$8::boolean,
          $9::integer,$10::date,$11::text,$12::text,$13::text,$14::jsonb,$15::jsonb,$16::text,
          $17::text,$18::text,$19::text,$20::text,$21::text,$22::text,$23::integer,$24::jsonb,
          $25::jsonb,$26::jsonb,$27::timestamptz
        ) AS result`,
        args,
      );
    const updateContinuationOpening = (owner, periodId, amount, initialization, provenance) =>
      user(owner, async (tx) => {
        const [current] = await tx.unsafe(
          "SELECT version FROM public.money_periods WHERE id=$1 AND owner_user_id=$2",
          [periodId, owner],
        );
        return tx.unsafe(
          `SELECT * FROM public.money_update_period(
            $1::uuid,$2::integer,NULL::date,NULL::jsonb,$3::integer,$4::text,$5::text,
            $6::jsonb,$7::text,$8::timestamptz
          )`,
          [
            periodId,
            current.version,
            amount,
            hex("d"),
            provenance.opening.note,
            provenance,
            initialization,
            new Date().toISOString(),
          ],
        );
      });

    // Finalizing the continuation successor before its superseded predecessor
    // must be blocked explicitly, not fail later as an overlap.
    const successorVersion = (
      await sql.unsafe("SELECT version FROM public.money_periods WHERE id=$1", [
        successor.id,
      ])
    )[0].version;
    let successorFirstBlocked = false;
    try {
      await user(A, (tx) =>
        callRollover(tx, [
          successor.id,
          successorVersion,
          addDays(expectedEnd, 1),
          addDays(expectedEnd, 20),
          addDays(expectedEnd, 1),
          "Africa/Casablanca",
          "initialized",
          false,
          0,
          expectedEnd,
          null,
          null,
          hex("d"),
          {},
          null,
          "f04-successor-first",
          hex("e"),
          "carry_forward",
          null,
          null,
          null,
          null,
          0,
          {},
          [],
          [],
          `${addDays(expectedEnd, 1)}T09:00:00.000Z`,
        ]),
      );
    } catch (error) {
      successorFirstBlocked =
        error.code === "23514" && /preceding period/.test(error.message);
    }
    assert(
      successorFirstBlocked,
      "finalizing a continuation successor before its predecessor is blocked",
    );
    const successorReceipt = await sql.unsafe(
      "SELECT count(*)::int n FROM public.money_period_rollovers WHERE owner_user_id=$1 AND source_period_id=$2",
      [A, successor.id],
    );
    assert(
      successorReceipt[0].n === 0,
      "the blocked successor finalization leaves no receipt",
    );

    let mismatchDenied = false;
    try {
      await user(A, (tx) =>
        callRollover(tx, rolloverArgs(expectedStart, addDays(expectedEnd, 1), modeledClosing, "f04-mismatch")),
      );
    } catch (error) {
      mismatchDenied = error.code === "40001";
    }
    assert(mismatchDenied, "a range that differs from the continued period conflicts");
    const noReceipt = await sql.unsafe(
      "SELECT count(*)::int n FROM public.money_period_rollovers WHERE owner_user_id=$1 AND source_period_id=$2",
      [A, sourceId],
    );
    assert(noReceipt[0].n === 0, "a refused adoption leaves no receipt");

    const adopted = await user(A, (tx) =>
      callRollover(tx, rolloverArgs(expectedStart, expectedEnd, modeledClosing, "f04-adopt")),
    );
    const receipt = adopted[0].result.rollover;
    assert(
      adopted[0].result.replayed === false && receipt.successor_period_id === successor.id,
      "finalization adopts the existing continued successor",
    );
    const afterAdoption = await sql.unsafe(
      `SELECT id, lifecycle, successor_period_id, finalization_reference, rolled_over_at
       FROM public.money_periods WHERE owner_user_id=$1 ORDER BY start_date`,
      [A],
    );
    assert(afterAdoption.length === 2, "adoption creates no duplicate successor");
    const adoptedSource = afterAdoption.find((row) => row.id === sourceId);
    assert(
      adoptedSource.lifecycle === "rolled_over" &&
        adoptedSource.successor_period_id === successor.id &&
        adoptedSource.finalization_reference !== null &&
        adoptedSource.rolled_over_at !== null,
      "the source is linked and marked rolled_over with retained finalization proof",
    );
    const successorOpenings = await sql.unsafe(
      `SELECT amount_minor FROM public.personal_expenses
       WHERE owner_user_id=$1 AND period_id=$2 AND kind='opening' AND deleted_at IS NULL`,
      [A, successor.id],
    );
    assert(
      successorOpenings.length === 1 && successorOpenings[0].amount_minor === modeledClosing,
      "adoption establishes exactly one carry-forward opening",
    );
    const preserved = await sql.unsafe(
      `SELECT count(*)::int n FROM public.personal_expenses
       WHERE owner_user_id=$1 AND period_id=$2 AND kind <> 'opening' AND deleted_at IS NULL`,
      [A, successor.id],
    );
    assert(preserved[0].n === 3, "the movements already recorded in the successor are preserved");
    const successorState = (
      await sql.unsafe(
        "SELECT initialization, opening_movement_id FROM public.money_periods WHERE id=$1",
        [successor.id],
      )
    )[0];
    assert(
      successorState.initialization === "initialized" &&
        successorState.opening_movement_id !== null,
      "the adopted successor records the initialized opening",
    );
    console.log("[ADOPT] explicit finalization adopts the continued period and establishes one opening");

    const replay = await user(A, (tx) =>
      callRollover(tx, rolloverArgs(expectedStart, expectedEnd, modeledClosing, "f04-adopt")),
    );
    assert(replay[0].result.replayed === true, "the same rollover operation replays its receipt");

    // --- Guard and grant boundaries ----------------------------------------
    let directSupersedeDenied = false;
    try {
      await user(A, (tx) =>
        tx.unsafe(
          "UPDATE public.money_periods SET lifecycle='superseded', version=version+1 WHERE id=$1",
          [successor.id],
        ),
      );
    } catch (error) {
      directSupersedeDenied = error.code === "42501";
    }
    assert(directSupersedeDenied, "an authenticated caller cannot write lifecycle directly");

    let preseedDenied = false;
    try {
      await user(A, (tx) =>
        tx.unsafe(
          `INSERT INTO public.money_periods
           (owner_user_id,start_date,end_date,currency,timezone,active_date,lifecycle,version)
           VALUES ($1,'2030-01-01','2030-01-02','MAD','Africa/Casablanca','2030-01-01','superseded',1)`,
          [A],
        ),
      );
    } catch (error) {
      preseedDenied = error.code === "23514";
    }
    assert(preseedDenied, "a direct insert cannot create a pre-superseded period");

    let readGrantDenied = false;
    try {
      await user(A, (tx) => continuePeriod(tx, addDays(today, 2)), "money-read");
    } catch (error) {
      readGrantDenied = error.code === "42501";
    }
    assert(readGrantDenied, "a read-only finance grant cannot continue a period");

    let readRoutineDenied = false;
    try {
      await user(
        A,
        (tx) =>
          recordRoutine(tx, {
            bookingDate: today,
            idempotencyKey: "money-f04-read-routine",
          }),
        "money-read",
      );
    } catch (error) {
      readRoutineDenied = error.code === "42501";
    }
    assert(
      readRoutineDenied,
      "a read-only finance grant cannot use the atomic routine write",
    );

    let crossOwnerDenied = false;
    try {
      await user(B, (tx) => continuePeriod(tx, today));
    } catch (error) {
      crossOwnerDenied = error.code === "42501";
    }
    assert(
      crossOwnerDenied,
      "the internal continuation RPC is not executable even for another owner",
    );
    const bPeriods = await user(B, (tx) =>
      tx.unsafe("SELECT count(*)::int n FROM public.money_periods"),
    );
    assert(bPeriods[0].n === 0, "the refused cross-owner call writes nothing");

    let anonymousDenied = false;
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe("SET LOCAL ROLE authenticated");
        await tx.unsafe("SELECT * FROM public.money_continue_period($1::date)", [today]);
      });
    } catch (error) {
      anonymousDenied = error.code === "42501";
    }
    assert(anonymousDenied, "an unauthenticated call is refused");

    // --- Opening mismatch on an existing continued opening -----------------
    const cCreated = await user(C, (tx) => createPeriod(tx, sourceStart, sourceEnd, sourceStart, 100000));
    const cSourceId = cCreated[0].id;
    await user(C, (tx) =>
      recordRoutine(tx, {
        bookingDate: today,
        idempotencyKey: "money-f04-c-continuation",
        fingerprint: hex("b"),
      }),
    );
    const cSuccessor = (
      await sql.unsafe(
        "SELECT * FROM public.money_periods WHERE owner_user_id=$1 AND lifecycle='tracking'",
        [C],
      )
    )[0];
    const cSourceVersion = (
      await sql.unsafe("SELECT version FROM public.money_periods WHERE id=$1", [cSourceId])
    )[0].version;
    await sql.unsafe(
      `INSERT INTO public.personal_expenses
       (owner_user_id,period_id,booking_date,kind,direction,amount_minor,currency,
        idempotency_key,create_fingerprint)
       VALUES ($1,$2,$3::date,'opening','in',50000,'MAD','opening:'||($2::uuid)::text,repeat('f',64))`,
      [C, cSuccessor.id, expectedStart],
    );
    await sql.unsafe(
      `UPDATE public.money_periods
       SET initialization='initialized',
           opening_movement_id=(SELECT id FROM public.personal_expenses WHERE owner_user_id=$1 AND period_id=$2 AND kind='opening'),
           version=version+1
       WHERE id=$2 AND owner_user_id=$1`,
      [C, cSuccessor.id],
    );
    let openingMismatchDenied = false;
    try {
      await user(C, (tx) =>
        callRollover(
          tx,
          [
            cSourceId,
            cSourceVersion,
            expectedStart,
            expectedEnd,
            expectedStart,
            "Africa/Casablanca",
            "reconciled",
            false,
            60000,
            sourceEnd,
            "Verified bank balance",
            "Finalized after review",
            hex("d"),
            {
              opening: {
                source: "verified_source",
                recordedAt: `${expectedStart}T09:00:00.000Z`,
                cutoffDate: sourceEnd,
                evidence: "Verified bank balance",
                note: "Finalized after review",
                corrections: [],
              },
              createdFrom: "web",
            },
            null,
            "f04-opening-mismatch",
            hex("e"),
            "verified_source",
            null,
            null,
            "Accepted difference",
            "Reviewed every unverified day",
            30,
            { modeledClosingCashMinor: 100000, pendingOccurrenceCount: 0 },
            [],
            [],
            `${expectedStart}T09:00:00.000Z`,
          ],
        ),
      );
    } catch (error) {
      openingMismatchDenied = error.code === "40001";
    }
    assert(
      openingMismatchDenied,
      "a different opening amount conflicts instead of overwriting the continued period",
    );

    // The same existing opening is kept (not duplicated) and can be upgraded to
    // the explicit verified evidence.
    const cAdopted = await user(C, (tx) =>
      callRollover(tx, [
        cSourceId,
        cSourceVersion,
        expectedStart,
        expectedEnd,
        expectedStart,
        "Africa/Casablanca",
        "reconciled",
        false,
        50000,
        sourceEnd,
        "Verified bank balance",
        "Finalized after review",
        hex("d"),
        {
          opening: {
            source: "verified_source",
            recordedAt: `${expectedStart}T09:00:00.000Z`,
            cutoffDate: sourceEnd,
            evidence: "Verified bank balance",
            note: "Finalized after review",
            corrections: [],
          },
          createdFrom: "web",
        },
        null,
        "f04-opening-same",
        hex("e"),
        "verified_source",
        null,
        null,
        "Accepted difference",
        "Reviewed every unverified day",
        30,
        { modeledClosingCashMinor: 100000, pendingOccurrenceCount: 0 },
        [],
        [],
        `${expectedStart}T09:00:00.000Z`,
      ]),
    );
    assert(
      cAdopted[0].result.rollover.successor_period_id === cSuccessor.id,
      "adoption keeps an existing opening with the same approved amount",
    );
    const cOpenings = await sql.unsafe(
      `SELECT amount_minor FROM public.personal_expenses
       WHERE owner_user_id=$1 AND period_id=$2 AND kind='opening' AND deleted_at IS NULL`,
      [C, cSuccessor.id],
    );
    assert(
      cOpenings.length === 1 && cOpenings[0].amount_minor === 50000,
      "the same-amount adoption does not duplicate the opening",
    );
    const cSuccessorState = (
      await sql.unsafe(
        "SELECT initialization FROM public.money_periods WHERE id=$1",
        [cSuccessor.id],
      )
    )[0];
    assert(
      cSuccessorState.initialization === "reconciled",
      "the same-amount adoption upgrades the retained opening evidence",
    );

    // --- Adoption identity is the date chain, not provenance JSON -----------
    const dCreated = await user(D, (tx) => createPeriod(tx, sourceStart, sourceEnd, sourceStart, 100000));
    const dSourceId = dCreated[0].id;
    await user(D, (tx) =>
      recordRoutine(tx, {
        bookingDate: today,
        idempotencyKey: "money-f04-d-continuation",
        fingerprint: hex("b"),
      }),
    );
    const dSuccessor = (
      await sql.unsafe(
        "SELECT * FROM public.money_periods WHERE owner_user_id=$1 AND lifecycle='tracking'",
        [D],
      )
    )[0];
    // Forge the descriptive provenance pointer. The real date chain still
    // identifies the continued period, so adoption must succeed without a
    // duplicate and a direct caller cannot steer adoption with this JSON.
    await sql.unsafe(
      `UPDATE public.money_periods
       SET provenance = COALESCE(provenance, '{}'::jsonb)
             || jsonb_build_object('continuedFrom', gen_random_uuid()::text),
           version = version + 1,
           updated_at = now()
       WHERE id=$1`,
      [dSuccessor.id],
    );
    const dSourceVersion = (
      await sql.unsafe("SELECT version FROM public.money_periods WHERE id=$1", [dSourceId])
    )[0].version;
    const dAdopted = await user(D, (tx) =>
      callRollover(
        tx,
        [
          dSourceId,
          dSourceVersion,
          expectedStart,
          expectedEnd,
          expectedStart,
          "Africa/Casablanca",
          "initialized",
          false,
          100000,
          sourceEnd,
          null,
          "Finalized after review",
          hex("d"),
          {
            opening: {
              source: "carry_forward",
              recordedAt: `${expectedStart}T09:00:00.000Z`,
              cutoffDate: sourceEnd,
              evidence: null,
              note: "Finalized after review",
              corrections: [],
            },
            createdFrom: "web",
          },
          null,
          "f04-forged",
          hex("e"),
          "carry_forward",
          null,
          null,
          null,
          "Reviewed every unverified day",
          30,
          { modeledClosingCashMinor: 100000, pendingOccurrenceCount: 0 },
          [],
          [],
          `${expectedStart}T09:00:00.000Z`,
        ],
      ),
    );
    assert(
      dAdopted[0].result.rollover.successor_period_id === dSuccessor.id,
      "adoption follows the adjacent date chain even when provenance JSON is forged",
    );
    const dPeriods = await sql.unsafe(
      "SELECT count(*)::int n FROM public.money_periods WHERE owner_user_id=$1",
      [D],
    );
    assert(dPeriods[0].n === 2, "the forged provenance creates no extra period");
    const dState = (
      await sql.unsafe(
        "SELECT lifecycle, successor_period_id FROM public.money_periods WHERE id=$1",
        [dSourceId],
      )
    )[0];
    assert(
      dState.lifecycle === "rolled_over" && dState.successor_period_id === dSuccessor.id,
      "the source links the adopted period from the real chain",
    );

    // --- Atomic write: a rejected insert rolls the continuation back --------
    const fCreated = await user(F, (tx) =>
      createPeriod(tx, sourceStart, sourceEnd, sourceStart, 100000),
    );
    const fSourceId = fCreated[0].id;
    let atomicRollback = false;
    try {
      await user(F, (tx) =>
        recordRoutine(tx, {
          bookingDate: today,
          amountMinor: 0,
          idempotencyKey: "money-f04-atomic-rollback",
        }),
      );
    } catch (error) {
      atomicRollback = error.code === "23514";
    }
    assert(atomicRollback, "an invalid routine insert is rejected");
    const fAfterRollback = await sql.unsafe(
      `SELECT count(*)::int AS periods,
              count(*) FILTER (WHERE lifecycle='tracking')::int AS tracking,
              count(*) FILTER (WHERE lifecycle='superseded')::int AS superseded
       FROM public.money_periods WHERE owner_user_id=$1`,
      [F],
    );
    assert(
      fAfterRollback[0].periods === 1 &&
        fAfterRollback[0].tracking === 1 &&
        fAfterRollback[0].superseded === 0,
      "a failed atomic write leaves the source tracking with no successor",
    );
    const fMovementCount = await sql.unsafe(
      "SELECT count(*)::int n FROM public.personal_expenses WHERE owner_user_id=$1",
      [F],
    );
    assert(fMovementCount[0].n === 1, "the failed atomic write inserts no movement");

    const fContinued = await user(F, (tx) =>
      recordRoutine(tx, {
        bookingDate: today,
        amountMinor: 2200,
        idempotencyKey: "money-f04-atomic-success",
        fingerprint: hex("c"),
      }),
    );
    const fState = await sql.unsafe(
      `SELECT id, lifecycle, successor_period_id
       FROM public.money_periods WHERE owner_user_id=$1 ORDER BY start_date`,
      [F],
    );
    assert(
      fState.length === 2 &&
        fState[0].id === fSourceId &&
        fState[0].lifecycle === "superseded" &&
        fState[1].lifecycle === "tracking" &&
        fContinued[0].period_id === fState[1].id,
      "a successful atomic write supersedes and inserts into the successor",
    );

    // --- Early finalization leaves the current day unwritable --------------
    const gCreated = await user(G, (tx) =>
      createPeriod(
        tx,
        addDays(today, -10),
        addDays(today, 10),
        today,
        100000,
      ),
    );
    const gVersion = (
      await sql.unsafe("SELECT version FROM public.money_periods WHERE id=$1", [
        gCreated[0].id,
      ])
    )[0].version;
    let earlyFinalizationBlocked = false;
    try {
      await user(G, (tx) =>
        callRollover(tx, [
          gCreated[0].id,
          gVersion,
          addDays(today, 11),
          addDays(today, 20),
          addDays(today, 11),
          "Africa/Casablanca",
          "initialized",
          false,
          100000,
          today,
          null,
          null,
          hex("d"),
          {},
          null,
          "f04-early-finalize",
          hex("e"),
          "carry_forward",
          null,
          null,
          null,
          null,
          0,
          {},
          [],
          [],
          `${addDays(today, 11)}T09:00:00.000Z`,
        ]),
      );
    } catch (error) {
      earlyFinalizationBlocked =
        error.code === "23514" && /outside a writable period/.test(error.message);
    }
    assert(
      earlyFinalizationBlocked,
      "carry-forward finalization before the source ends is blocked",
    );
    const gState = await sql.unsafe(
      "SELECT lifecycle, successor_period_id FROM public.money_periods WHERE id=$1",
      [gCreated[0].id],
    );
    assert(
      gState[0].lifecycle === "tracking" && gState[0].successor_period_id === null,
      "the blocked early finalization leaves the source tracking",
    );

    // --- Concurrent first routine writes converge on one successor ----------
    await user(H, (tx) =>
      createPeriod(tx, sourceStart, sourceEnd, sourceStart, 100000),
    );
    const concurrent = await Promise.all([
      user(H, (tx) =>
        recordRoutine(tx, {
          bookingDate: today,
          amountMinor: 2100,
          category: "coffee",
          idempotencyKey: "money-f04-concurrent-a",
          fingerprint: hex("c"),
        }),
      ),
      user(H, (tx) =>
        recordRoutine(tx, {
          bookingDate: today,
          amountMinor: 2300,
          category: "groceries",
          idempotencyKey: "money-f04-concurrent-b",
          fingerprint: hex("d"),
        }),
      ),
    ]);
    const hPeriods = await sql.unsafe(
      `SELECT id, lifecycle, start_date FROM public.money_periods WHERE owner_user_id=$1 ORDER BY start_date`,
      [H],
    );
    assert(
      hPeriods.length === 2 &&
        hPeriods.filter((row) => row.lifecycle === "tracking").length === 1 &&
        hPeriods.filter((row) => row.lifecycle === "superseded").length === 1,
      "concurrent routine writes create exactly one superseded source and one successor",
    );
    const successorId = hPeriods.find((row) => row.lifecycle === "tracking").id;
    assert(
      concurrent[0][0].period_id === successorId &&
        concurrent[1][0].period_id === successorId &&
        concurrent[0][0].booking_date === today &&
        concurrent[1][0].booking_date === today,
      "both concurrent routine writes land in the same tracking successor",
    );
    const hMovementCount = await sql.unsafe(
      "SELECT count(*)::int n FROM public.personal_expenses WHERE owner_user_id=$1 AND kind <> 'opening'",
      [H],
    );
    assert(
      hMovementCount[0].n === 2,
      "the concurrent retry inserts each distinct routine movement exactly once",
    );

    // --- Unknown-opening superseded predecessor can be initialized ---------
    // Default period creation leaves the opening unknown. Automatic
    // continuation then supersedes it. Finalization cannot review cash without
    // that opening, so the non-finalized superseded range must accept exactly
    // its missing opening initialization; active dates and settings stay shut.
    const iStart = addDays(today, -5);
    const iEnd = addDays(today, -1);
    const iCreated = await user(I, (tx) =>
      createPeriod(tx, iStart, iEnd, iStart, null),
    );
    const iSourceId = iCreated[0].id;
    assert(
      iCreated[0].lifecycle === "tracking",
      "the unknown-opening fixture starts tracking",
    );
    const iUnknown = await sql.unsafe(
      "SELECT initialization, opening_movement_id FROM public.money_periods WHERE id=$1",
      [iSourceId],
    );
    assert(
      iUnknown[0].initialization === "uninitialized" &&
        iUnknown[0].opening_movement_id === null,
      "the unknown-opening fixture has no opening ledger row",
    );
    await user(I, (tx) =>
      recordRoutine(tx, {
        bookingDate: today,
        amountMinor: 1800,
        category: "coffee",
        idempotencyKey: "money-f04-i-successor",
        fingerprint: hex("e"),
      }),
    );
    const iSource = (
      await sql.unsafe(
        "SELECT lifecycle, end_date, version FROM public.money_periods WHERE id=$1",
        [iSourceId],
      )
    )[0];
    assert(
      iSource.lifecycle === "superseded" && iSource.end_date === iEnd,
      "continuation leaves the unknown-opening source non-finalized",
    );

    // A superseded period can itself be a continuation successor (a chain).
    // Seed that descriptive pointer so initializing its opening proves the
    // merge path keeps it instead of replacing provenance.
    const iContinuedFrom = "bbbbbbbb-9999-4999-8999-999999999999";
    await sql.unsafe(
      `UPDATE public.money_periods
       SET provenance = COALESCE(provenance, '{}'::jsonb)
             || jsonb_build_object('continuedFrom', $2::text),
           version = version + 1,
           updated_at = now()
       WHERE id=$1`,
      [iSourceId, iContinuedFrom],
    );
    const iSourceVersion = (
      await sql.unsafe("SELECT version FROM public.money_periods WHERE id=$1", [
        iSourceId,
      ])
    )[0].version;

    const iSummaryBefore = await user(I, (tx) =>
      tx.unsafe(
        "SELECT public.money_rollover_close_snapshot_summary($1::uuid) AS summary",
        [iSourceId],
      ),
    );
    assert(
      iSummaryBefore[0].summary.available === false &&
        iSummaryBefore[0].summary.reason === "opening_unknown",
      "finalization cannot review an unknown source opening",
    );

    let iActiveMoveDenied = false;
    try {
      await user(I, (tx) =>
        tx.unsafe(
          `SELECT * FROM public.money_update_period(
            $1::uuid,$2::integer,$3::date,NULL::jsonb,NULL::integer,NULL::text,
            NULL::text,NULL::jsonb,NULL::text,now()::timestamptz
          )`,
          [iSourceId, iSourceVersion, addDays(iStart, 1)],
        ),
      );
    } catch (error) {
      iActiveMoveDenied = error.code === "23514";
    }
    assert(
      iActiveMoveDenied,
      "a superseded period still refuses an active-date move",
    );

    const iInitialized = await user(I, (tx) =>
      tx.unsafe(
        `SELECT * FROM public.money_update_period(
          $1::uuid,$2::integer,NULL::date,NULL::jsonb,$3::integer,$4::text,
          NULL::text,$5::jsonb,'initialized'::text,now()::timestamptz
        )`,
        [
          iSourceId,
          iSourceVersion,
          50000,
          hex("a"),
          {
            opening: {
              source: "user_entered",
              recordedAt: `${iStart}T12:00:00.000Z`,
              cutoffDate: iStart,
              evidence: null,
              note: "Initialized after automatic continuation",
              corrections: [],
            },
            createdFrom: "web",
          },
        ],
      ),
    );
    assert(
      iInitialized.length === 1 &&
        iInitialized[0].lifecycle === "superseded" &&
        iInitialized[0].initialization === "initialized" &&
        iInitialized[0].opening_movement_id !== null &&
        iInitialized[0].active_date === iStart,
      "a non-finalized superseded period accepts exactly its missing opening",
    );
    const iOpening = await sql.unsafe(
      "SELECT amount_minor, booking_date FROM public.personal_expenses WHERE owner_user_id=$1 AND period_id=$2 AND kind='opening'",
      [I, iSourceId],
    );
    assert(
      iOpening.length === 1 &&
        iOpening[0].amount_minor === 50000 &&
        iOpening[0].booking_date === iStart,
      "the superseded opening is one canonical opening movement on its start date",
    );
    assert(
      iInitialized[0].provenance?.continuedFrom === iContinuedFrom &&
        iInitialized[0].provenance?.opening?.source === "user_entered",
      "initializing the superseded opening preserves continuation provenance",
    );

    let iSecondOpeningDenied = false;
    try {
      await user(I, (tx) =>
        tx.unsafe(
          `SELECT * FROM public.money_update_period(
            $1::uuid,$2::integer,NULL::date,NULL::jsonb,$3::integer,$4::text,
            NULL::text,$5::jsonb,'initialized'::text,now()::timestamptz
          )`,
          [
            iSourceId,
            iInitialized[0].version,
            51000,
            hex("b"),
            {
              opening: {
                source: "user_entered",
                recordedAt: `${iStart}T12:00:00.000Z`,
                cutoffDate: iStart,
                evidence: null,
                note: "Second attempt",
                corrections: [],
              },
              createdFrom: "web",
            },
          ],
        ),
      );
    } catch (error) {
      iSecondOpeningDenied = error.code === "23514";
    }
    assert(
      iSecondOpeningDenied,
      "once initialized, the superseded period refuses further settings-style updates",
    );

    const iSuccessor = (
      await sql.unsafe(
        "SELECT id, start_date, end_date FROM public.money_periods WHERE owner_user_id=$1 AND lifecycle='tracking'",
        [I],
      )
    )[0];
    const iAdopted = await user(I, (tx) =>
      callRollover(tx, [
        iSourceId,
        iInitialized[0].version,
        iSuccessor.start_date,
        iSuccessor.end_date,
        iSuccessor.start_date,
        "Africa/Casablanca",
        "initialized",
        false,
        50000,
        iEnd,
        null,
        "Initialized after continuation",
        hex("d"),
        {
          opening: {
            source: "carry_forward",
            recordedAt: `${iSuccessor.start_date}T09:00:00.000Z`,
            cutoffDate: iEnd,
            evidence: null,
            note: "Initialized after continuation",
            corrections: [],
          },
          createdFrom: "web",
        },
        null,
        "f04-unknown-opening-adopt",
        hex("e"),
        "carry_forward",
        null,
        null,
        null,
        "Reviewed every unverified day after initializing the opening",
        5,
        { modeledClosingCashMinor: 50000, pendingOccurrenceCount: 0 },
        [],
        [],
        `${iSuccessor.start_date}T09:00:00.000Z`,
      ]),
    );
    assert(
      iAdopted[0].result.rollover.successor_period_id === iSuccessor.id,
      "the initialized superseded period finalizes by adopting its successor",
    );
    const iSourceAfter = (
      await sql.unsafe(
        "SELECT lifecycle, successor_period_id FROM public.money_periods WHERE id=$1",
        [iSourceId],
      )
    )[0];
    assert(
      iSourceAfter.lifecycle === "rolled_over" &&
        iSourceAfter.successor_period_id === iSuccessor.id,
      "the previously unfinalizable predecessor is now linked",
    );
    console.log("[INIT] a non-finalized superseded opening is initialized and then adopted");

    // --- A source that still owns today cannot be finalized ---------------
    // Both opening modes are blocked while the source's own calendar day is
    // today, for a tracking period and for a superseded one. This is the
    // regression that kept a later same-day entry without any writable period.
    const jStart = addDays(today, -3);
    const jCreated = await user(J, (tx) =>
      createPeriod(tx, jStart, today, jStart, 100000),
    );
    const jSourceId = jCreated[0].id;
    let jVersion = jCreated[0].version;
    const jFuture = addDays(today, 1);
    const jFutureEnd = endOfMonth(jFuture);

    const callJRollover = (tx, mode, start, end, cutoff) =>
      callRollover(tx, [
        jSourceId,
        jVersion,
        start,
        end,
        start,
        "Africa/Casablanca",
        mode === "carry_forward" ? "initialized" : "reconciled",
        false,
        100000,
        cutoff,
        mode === "verified_source" ? "Verified same-day balance" : null,
        null,
        hex("d"),
        {
          opening: {
            source: mode,
            recordedAt: `${start}T09:00:00.000Z`,
            cutoffDate: cutoff,
            evidence: mode === "verified_source" ? "Verified same-day balance" : null,
            note: null,
            corrections: [],
          },
          createdFrom: "web",
        },
        null,
        `f04-same-day-${mode}`,
        hex("e"),
        mode,
        null,
        null,
        mode === "verified_source" ? "Reviewed same-day balance" : null,
        "Reviewed every unverified day",
        4,
        { modeledClosingCashMinor: 100000, pendingOccurrenceCount: 0 },
        [],
        [],
        `${start}T09:00:00.000Z`,
      ]);

    let jTrackingVerifiedDenied = false;
    try {
      await user(J, (tx) =>
        callJRollover(tx, "verified_source", jFuture, jFutureEnd, today),
      );
    } catch (error) {
      jTrackingVerifiedDenied =
        error.code === "23514" && /outside a writable period/.test(error.message);
    }
    assert(
      jTrackingVerifiedDenied,
      "verified finalization on the source's own end date is blocked",
    );

    // The continuation rule now refuses a future date, so this state is only
    // reachable from legacy/manual lifecycle data. Keep the finalization guard
    // honest for that retained state.
    await sql.unsafe(
      `UPDATE public.money_periods
       SET lifecycle='superseded', version=version+1, updated_at=now()
       WHERE id=$1 AND owner_user_id=$2`,
      [jSourceId, J],
    );
    const jState = (
      await sql.unsafe(
        "SELECT lifecycle, end_date, version FROM public.money_periods WHERE id=$1",
        [jSourceId],
      )
    )[0];
    assert(
      jState.lifecycle === "superseded" && jState.end_date === today,
      "the legacy fixture is a superseded period that still owns today",
    );
    jVersion = jState.version;

    for (const mode of ["carry_forward", "verified_source"]) {
      let denied = false;
      try {
        await user(J, (tx) =>
          callJRollover(
            tx,
            mode,
            jFuture,
            jFutureEnd,
            today,
          ),
        );
      } catch (error) {
        denied =
          error.code === "23514" && /outside a writable period/.test(error.message);
      }
      assert(
        denied,
        `a superseded source that still owns today blocks ${mode} finalization`,
      );
    }
    const jReceipts = await sql.unsafe(
      "SELECT count(*)::int n FROM public.money_period_rollovers WHERE owner_user_id=$1 AND source_period_id=$2",
      [J, jSourceId],
    );
    assert(jReceipts[0].n === 0, "blocked same-day finalizations leave no receipt");
    console.log("[EARLY] tracking and superseded sources cannot finalize on their own end date");

    // --- Period-date preflight, soft delete and corrections ----------------
    // A legacy row can predate the invariant. The migration preflight must
    // report it instead of silently creating undeletable history, while a soft
    // delete or an in-range correction still succeeds.
    await user(E, (tx) =>
      createPeriod(tx, sourceStart, sourceEnd, sourceStart, 100000),
    );
    const ePeriodId = (
      await sql.unsafe(
        "SELECT id FROM public.money_periods WHERE owner_user_id=$1 ORDER BY start_date LIMIT 1",
        [E],
      )
    )[0].id;
    const legacyRow = await sql.unsafe(
      `INSERT INTO public.personal_expenses
       (owner_user_id,period_id,booking_date,kind,direction,amount_minor,currency,
        category,need_vs_want,purpose,counts_in_daily,idempotency_key,create_fingerprint)
       VALUES ($1,$2,$3::date,'expense','out',900,'MAD',
        'coffee','want','flexible',true,'money-f04-preflight-row',repeat('a',64))
       RETURNING id`,
      [E, ePeriodId, sourceEnd],
    );
    const legacyRowId = legacyRow[0].id;
    await sql.unsafe(
      `UPDATE public.personal_expenses
       SET booking_date=$1::date, version=version+1, updated_at=now()
       WHERE id=$2`,
      [addDays(sourceStart, 5), legacyRowId],
    );
    const correctedInRange = await sql.unsafe(
      "SELECT booking_date FROM public.personal_expenses WHERE id=$1",
      [legacyRowId],
    );
    assert(
      correctedInRange[0].booking_date === addDays(sourceStart, 5),
      "an in-range booking-date correction still succeeds",
    );

    await sql.unsafe(
      'ALTER TABLE public.personal_expenses DISABLE TRIGGER "personal_expenses_period_date_guard"',
    );
    await sql.unsafe(
      `UPDATE public.personal_expenses
       SET booking_date=$1::date, version=version+1, updated_at=now()
       WHERE id=$2`,
      [addDays(sourceEnd, 60), legacyRowId],
    );
    await sql.unsafe(
      'ALTER TABLE public.personal_expenses ENABLE TRIGGER "personal_expenses_period_date_guard"',
    );
    let preflightDenied = false;
    try {
      await sql.unsafe("SELECT public.money_assert_period_booking_dates()");
    } catch (error) {
      preflightDenied = error.code === "23514" && /outside their period/.test(error.message);
    }
    assert(
      preflightDenied,
      "the migration preflight reports an active movement outside its period",
    );

    await sql.unsafe(
      `UPDATE public.personal_expenses
       SET deleted_at=now(), version=version+1, updated_at=now()
       WHERE id=$1`,
      [legacyRowId],
    );
    await sql.unsafe("SELECT public.money_assert_period_booking_dates()");
    const softDeletedLegacy = await sql.unsafe(
      "SELECT deleted_at FROM public.personal_expenses WHERE id=$1",
      [legacyRowId],
    );
    assert(
      softDeletedLegacy[0].deleted_at !== null,
      "a legacy out-of-range row can still be soft-deleted",
    );

    let directOutOfRangeDenied = false;
    try {
      await user(E, (tx) =>
        tx.unsafe(
          `INSERT INTO public.personal_expenses
           (owner_user_id,period_id,booking_date,kind,direction,amount_minor,currency,
            idempotency_key,create_fingerprint)
           VALUES ($1,$2,$3::date,'expense','out',1000,'MAD',
            'money-f04-out-of-range',repeat('b',64))`,
          [E, ePeriodId, addDays(sourceEnd, 10)],
        ),
      );
    } catch (error) {
      directOutOfRangeDenied = error.code === "23514";
    }
    assert(
      directOutOfRangeDenied,
      "an active movement cannot be written outside its period",
    );
    await sql.unsafe("DELETE FROM public.personal_expenses WHERE id=$1", [legacyRowId]);
    console.log("[PREFLIGHT] out-of-period rows are reported, correctable and soft-deletable");

    // --- A stale routine resolution cannot land after rollover -------------
    // Resolve a non-finalized superseded period on one connection, pause, let
    // the explicit rollover finalize it on another connection, then continue
    // the stale routine transaction. The atomic path must revalidate the
    // lifecycle under the shared lock and write no movement or receipt.
    const kSourceStart = addDays(today, -70);
    const kSourceEnd = addDays(today, -40);
    const kCreated = await user(K, (tx) =>
      createPeriod(tx, kSourceStart, kSourceEnd, kSourceStart, 100000),
    );
    const kSourceId = kCreated[0].id;
    await user(K, (tx) =>
      recordRoutine(tx, {
        bookingDate: addDays(today, -20),
        amountMinor: 1400,
        category: "household",
        needVsWant: "need",
        idempotencyKey: "money-f04-k-continuation",
        fingerprint: hex("c"),
      }),
    );
    const kPeriods = await sql.unsafe(
      `SELECT id, start_date, end_date, lifecycle, version
       FROM public.money_periods WHERE owner_user_id=$1 ORDER BY start_date`,
      [K],
    );
    assert(
      kPeriods.length === 2 &&
        kPeriods[0].id === kSourceId &&
        kPeriods[0].lifecycle === "superseded" &&
        kPeriods[1].lifecycle === "tracking",
      "the stale-resolution fixture has one superseded source and one tracking successor",
    );
    const kSuccessor = kPeriods[1];
    const kSourceVersion = kPeriods[0].version;
    const kRollover = (tx, operationId) =>
      callRollover(tx, [
        kSourceId,
        kSourceVersion,
        kSuccessor.start_date,
        kSuccessor.end_date,
        kSuccessor.start_date,
        "Africa/Casablanca",
        "initialized",
        false,
        100000,
        kSourceEnd,
        null,
        "Finalized after review",
        hex("d"),
        {
          opening: {
            source: "carry_forward",
            recordedAt: `${kSuccessor.start_date}T09:00:00.000Z`,
            cutoffDate: kSourceEnd,
            evidence: null,
            note: "Finalized after review",
            corrections: [],
          },
          createdFrom: "web",
        },
        null,
        operationId,
        hex("e"),
        "carry_forward",
        null,
        null,
        null,
        "Reviewed every unverified day",
        (Date.parse(kSourceEnd) - Date.parse(kSourceStart)) / 86_400_000 + 1,
        { modeledClosingCashMinor: 100000, pendingOccurrenceCount: 0 },
        [],
        [],
        `${kSuccessor.start_date}T09:00:00.000Z`,
      ]);

    let markResolved;
    let releaseStale;
    const staleResolved = new Promise((resolve) => {
      markResolved = resolve;
    });
    const staleRelease = new Promise((resolve) => {
      releaseStale = resolve;
    });
    const staleTransaction = beginAs(K, "f04-stale-routine", async (tx) => {
      const [resolved] = await tx.unsafe(
        `SELECT id, lifecycle FROM public.money_periods
         WHERE owner_user_id=$1 AND lifecycle='superseded'
           AND $2::date BETWEEN start_date AND end_date`,
        [K, kSourceEnd],
      );
      markResolved(resolved);
      await staleRelease;
      return recordRoutine(tx, {
        bookingDate: kSourceEnd,
        amountMinor: 1300,
        category: "coffee",
        idempotencyKey: "money-f04-k-stale",
        fingerprint: hex("f"),
      });
    });
    const staleResolution = await staleResolved;
    assert(
      staleResolution.id === kSourceId &&
        staleResolution.lifecycle === "superseded",
      "the stale transaction resolved the source before finalization",
    );
    await user(K, (tx) => kRollover(tx, "f04-k-stale-rollover"));
    releaseStale();
    let staleAfterRolloverDenied = false;
    try {
      await staleTransaction;
    } catch (error) {
      staleAfterRolloverDenied = error.code === "23514";
    }
    assert(
      staleAfterRolloverDenied,
      "a routine write that resolved a period before rollover is refused after finalization",
    );
    const staleMovement = await sql.unsafe(
      `SELECT count(*)::int n FROM public.personal_expenses
       WHERE owner_user_id=$1 AND idempotency_key=$2`,
      [K, "money-f04-k-stale"],
    );
    assert(
      staleMovement[0].n === 0,
      "the stale routine write creates no movement after the period was finalized",
    );
    const kReceipts = await sql.unsafe(
      "SELECT count(*)::int n FROM public.money_period_rollovers WHERE owner_user_id=$1 AND source_period_id=$2",
      [K, kSourceId],
    );
    assert(
      kReceipts[0].n === 1,
      "the stale routine write creates no second receipt beside the rollover",
    );
    console.log("[STALE] a paused routine resolution cannot land after rollover");

    // --- Equal-amount adoption keeps corrections and upgrades evidence -----
    const lSourceStart = addDays(today, -40);
    const lSourceEnd = addDays(today, -11);
    const lCreated = await user(L, (tx) =>
      createPeriod(tx, lSourceStart, lSourceEnd, lSourceStart, 100000),
    );
    const lSourceId = lCreated[0].id;
    await user(L, (tx) =>
      recordRoutine(tx, {
        bookingDate: today,
        amountMinor: 2100,
        category: "groceries",
        needVsWant: "need",
        idempotencyKey: "money-f04-l-continuation",
        fingerprint: hex("c"),
      }),
    );
    const lSuccessor = (
      await sql.unsafe(
        "SELECT * FROM public.money_periods WHERE owner_user_id=$1 AND lifecycle='tracking'",
        [L],
      )
    )[0];
    const lSourceVersion = (
      await sql.unsafe("SELECT version FROM public.money_periods WHERE id=$1", [lSourceId])
    )[0].version;
    await updateContinuationOpening(L, lSuccessor.id, 99000, "initialized", {
      opening: {
        source: "user_entered",
        recordedAt: `${lSuccessor.start_date}T08:00:00.000Z`,
        cutoffDate: lSuccessor.start_date,
        evidence: null,
        note: "counted",
        corrections: [],
      },
      createdFrom: "web",
    });
    await updateContinuationOpening(L, lSuccessor.id, 97000, "initialized", {
      opening: {
        source: "user_entered",
        recordedAt: `${lSuccessor.start_date}T09:00:00.000Z`,
        cutoffDate: lSuccessor.start_date,
        evidence: null,
        note: "recount",
        corrections: [
          {
            at: `${lSuccessor.start_date}T09:00:00.000Z`,
            amountMinor: 97000,
            previousAmountMinor: 99000,
            ledgerVersion: 2,
            source: "user_entered",
            note: "recount",
          },
        ],
      },
      createdFrom: "web",
    });
    const forgedRecordedAt = "1999-01-01T00:00:00.000Z";
    const lRolloverArgs = (cutoffDate, operationId) => [
      lSourceId,
      lSourceVersion,
      lSuccessor.start_date,
      lSuccessor.end_date,
      lSuccessor.start_date,
      "Africa/Casablanca",
      "reconciled",
      false,
      97000,
      cutoffDate,
      "Verified bank balance",
      "Finalized after review",
      hex("d"),
      {
        opening: {
          source: "verified_source",
          recordedAt: forgedRecordedAt,
          cutoffDate,
          evidence: "Verified bank balance",
          note: "Finalized after review",
          corrections: [],
        },
        createdFrom: "web",
      },
      null,
      operationId,
      hex("e"),
      "verified_source",
      null,
      null,
      "Accepted difference",
      "Reviewed every unverified day",
      30,
      { modeledClosingCashMinor: 100000, pendingOccurrenceCount: 0 },
      [],
      [],
      `${lSuccessor.start_date}T09:00:00.000Z`,
    ];

    const provenanceMismatchArgs = lRolloverArgs(
      lSourceEnd,
      "f04-l-provenance-cutoff-mismatch",
    );
    provenanceMismatchArgs[13] = {
      ...provenanceMismatchArgs[13],
      opening: {
        ...provenanceMismatchArgs[13].opening,
        cutoffDate: addDays(lSourceEnd, 1),
      },
    };
    let provenanceCutoffMismatchDenied = false;
    try {
      await user(L, (tx) => callRollover(tx, provenanceMismatchArgs));
    } catch (error) {
      provenanceCutoffMismatchDenied = error.code === "40001";
    }
    assert(
      provenanceCutoffMismatchDenied,
      "a provenance cutoff that disagrees with the validated cutoff is refused",
    );
    const lBlockedReceipts = await sql.unsafe(
      "SELECT count(*)::int n FROM public.money_period_rollovers WHERE owner_user_id=$1 AND source_period_id=$2",
      [L, lSourceId],
    );
    assert(lBlockedReceipts[0].n === 0, "the provenance cutoff conflict leaves no receipt");

    await user(L, (tx) => callRollover(tx, lRolloverArgs(lSourceEnd, "f04-l-adopt")));
    const lAfter = (
      await sql.unsafe(
        "SELECT initialization, provenance FROM public.money_periods WHERE id=$1",
        [lSuccessor.id],
      )
    )[0];
    assert(
      lAfter.initialization === "reconciled",
      "the equal-amount adoption upgrades the retained opening evidence",
    );
    const lOpening = lAfter.provenance?.opening;
    assert(
      Array.isArray(lOpening?.corrections) &&
        lOpening.corrections.length === 1 &&
        lOpening.corrections[0].previousAmountMinor === 99000,
      "the equal-amount adoption preserves the retained correction history",
    );
    assert(
      lOpening?.source === "verified_source" &&
        lOpening?.cutoffDate === lSourceEnd &&
        lOpening?.evidence === "Verified bank balance",
      "the upgraded opening uses the validated verified evidence",
    );
    assert(
      lOpening?.recordedAt !== forgedRecordedAt &&
        Date.parse(lOpening?.recordedAt) > Date.parse("2026-01-01T00:00:00.000Z"),
      "the upgraded opening timestamp comes from the database clock, not the caller payload",
    );
    assert(
      lOpening?.evidenceUpgrade?.from?.source === "user_entered" &&
        lOpening?.evidenceUpgrade?.from?.cutoffDate === lSuccessor.start_date &&
        lOpening?.evidenceUpgrade?.toCutoffDate === lSourceEnd,
      "the evidence upgrade records the previous and validated cutoff explicitly",
    );
    const lOpeningRows = await sql.unsafe(
      `SELECT count(*)::int n, min(amount_minor)::int amount
       FROM public.personal_expenses
       WHERE owner_user_id=$1 AND period_id=$2 AND kind='opening' AND deleted_at IS NULL`,
      [L, lSuccessor.id],
    );
    assert(
      lOpeningRows[0].n === 1 && lOpeningRows[0].amount === 97000,
      "the equal-amount adoption keeps exactly one opening movement",
    );
    const lReceipt = (
      await sql.unsafe(
        "SELECT opening_amount_minor, closing_cutoff_date FROM public.money_period_rollovers WHERE owner_user_id=$1 AND source_period_id=$2",
        [L, lSourceId],
      )
    )[0];
    assert(
      lReceipt.opening_amount_minor === 97000 && lReceipt.closing_cutoff_date === lSourceEnd,
      "the receipt and the retained provenance agree on the validated cutoff",
    );
    console.log("[PROVENANCE] equal-amount adoption preserves corrections and records the evidence upgrade");

    // A normal opening correction after adoption replaces the active opening
    // fields but must retain the recorded evidence-upgrade history.
    await updateContinuationOpening(L, lSuccessor.id, 96000, "reconciled", {
      opening: {
        source: "verified_source",
        recordedAt: `${lSuccessor.start_date}T12:00:00.000Z`,
        cutoffDate: lSuccessor.start_date,
        evidence: "Recount statement",
        note: "recounted after adoption",
        corrections: [],
      },
      createdFrom: "web",
    });
    const lCorrected = (
      await sql.unsafe(
        "SELECT initialization, provenance FROM public.money_periods WHERE id=$1",
        [lSuccessor.id],
      )
    )[0];
    const lCorrectedOpening = lCorrected.provenance?.opening;
    assert(
      lCorrected.initialization === "reconciled" &&
        lCorrectedOpening?.note === "recounted after adoption" &&
        lCorrectedOpening?.evidence === "Recount statement" &&
        lCorrectedOpening?.cutoffDate === lSuccessor.start_date,
      "a normal opening correction updates the active opening evidence",
    );
    assert(
      lCorrectedOpening?.evidenceUpgrade?.toCutoffDate === lSourceEnd &&
        lCorrectedOpening?.evidenceUpgrade?.from?.source === "user_entered" &&
        lCorrectedOpening?.evidenceUpgrade?.from?.cutoffDate ===
          lSuccessor.start_date,
      "a normal opening correction preserves the adoption evidence-upgrade history",
    );
    const lCorrectedRows = await sql.unsafe(
      `SELECT count(*)::int n, min(amount_minor)::int amount
       FROM public.personal_expenses
       WHERE owner_user_id=$1 AND period_id=$2 AND kind='opening' AND deleted_at IS NULL`,
      [L, lSuccessor.id],
    );
    assert(
      lCorrectedRows[0].n === 1 && lCorrectedRows[0].amount === 96000,
      "the correction keeps exactly one updated opening movement",
    );
    console.log("[PROVENANCE] a normal opening correction preserves the recorded evidence upgrade");

    // --- A retained verified cutoff cannot be silently rewritten ------------
    const mCreated = await user(M, (tx) =>
      createPeriod(tx, lSourceStart, lSourceEnd, lSourceStart, 100000),
    );
    const mSourceId = mCreated[0].id;
    await user(M, (tx) =>
      recordRoutine(tx, {
        bookingDate: today,
        amountMinor: 2200,
        category: "household",
        needVsWant: "need",
        idempotencyKey: "money-f04-m-continuation",
        fingerprint: hex("c"),
      }),
    );
    const mSuccessor = (
      await sql.unsafe(
        "SELECT * FROM public.money_periods WHERE owner_user_id=$1 AND lifecycle='tracking'",
        [M],
      )
    )[0];
    const mSourceVersion = (
      await sql.unsafe("SELECT version FROM public.money_periods WHERE id=$1", [mSourceId])
    )[0].version;
    await updateContinuationOpening(M, mSuccessor.id, 97000, "reconciled", {
      opening: {
        source: "verified_source",
        recordedAt: `${mSuccessor.start_date}T09:00:00.000Z`,
        cutoffDate: mSuccessor.start_date,
        evidence: "Retained bank statement",
        note: "verified at the successor start",
        corrections: [],
      },
      createdFrom: "web",
    });
    let retainedCutoffMismatchDenied = false;
    try {
      await user(M, (tx) =>
        callRollover(tx, [
          mSourceId,
          mSourceVersion,
          mSuccessor.start_date,
          mSuccessor.end_date,
          mSuccessor.start_date,
          "Africa/Casablanca",
          "reconciled",
          false,
          97000,
          lSourceEnd,
          "Verified bank balance",
          "Finalized after review",
          hex("d"),
          {
            opening: {
              source: "verified_source",
              recordedAt: `${mSuccessor.start_date}T10:00:00.000Z`,
              cutoffDate: lSourceEnd,
              evidence: "Verified bank balance",
              note: "Finalized after review",
              corrections: [],
            },
            createdFrom: "web",
          },
          null,
          "f04-m-retained-cutoff-mismatch",
          hex("e"),
          "verified_source",
          null,
          null,
          "Accepted difference",
          "Reviewed every unverified day",
          30,
          { modeledClosingCashMinor: 100000, pendingOccurrenceCount: 0 },
          [],
          [],
          `${mSuccessor.start_date}T10:00:00.000Z`,
        ]),
      );
    } catch (error) {
      retainedCutoffMismatchDenied = error.code === "40001";
    }
    assert(
      retainedCutoffMismatchDenied,
      "a retained verified cutoff that differs from the approved cutoff is refused",
    );
    const mAfter = (
      await sql.unsafe(
        "SELECT initialization, provenance FROM public.money_periods WHERE id=$1",
        [mSuccessor.id],
      )
    )[0];
    assert(
      mAfter.initialization === "reconciled" &&
        mAfter.provenance?.opening?.cutoffDate === mSuccessor.start_date,
      "the refused adoption leaves the retained verified cutoff unchanged",
    );
    const mReceipts = await sql.unsafe(
      "SELECT count(*)::int n FROM public.money_period_rollovers WHERE owner_user_id=$1 AND source_period_id=$2",
      [M, mSourceId],
    );
    assert(mReceipts[0].n === 0, "the retained cutoff conflict leaves no receipt");
    console.log("[PROVENANCE] a retained verified cutoff mismatch is refused without mutation");

    // --- Continuation and adoption share one lock order --------------------
    // The holder keeps the later tracking row locked. The routine write takes
    // the owner-scoped lock first, so it waits while holding the earlier source;
    // the rollover then waits behind the routine write instead of holding the
    // source and waiting for the tracking row. Releasing the holder lets both
    // transactions finish without a deadlock (40P01).
    const nSourceStart = addDays(today, -90);
    const nSourceEnd = addDays(today, -61);
    const nCreated = await user(N, (tx) =>
      createPeriod(tx, nSourceStart, nSourceEnd, nSourceStart, 100000),
    );
    const nSourceId = nCreated[0].id;
    await user(N, (tx) =>
      recordRoutine(tx, {
        bookingDate: addDays(today, -60),
        amountMinor: 1500,
        category: "coffee",
        needVsWant: "want",
        idempotencyKey: "money-f04-n-first-continuation",
        fingerprint: hex("c"),
      }),
    );
    const nFirstSuccessor = (
      await sql.unsafe(
        "SELECT * FROM public.money_periods WHERE owner_user_id=$1 AND lifecycle='tracking'",
        [N],
      )
    )[0];
    const nSourceVersion = (
      await sql.unsafe("SELECT version FROM public.money_periods WHERE id=$1", [nSourceId])
    )[0].version;

    let markHolderReady;
    let releaseHolder;
    const holderReady = new Promise((resolve) => {
      markHolderReady = resolve;
    });
    const holderRelease = new Promise((resolve) => {
      releaseHolder = resolve;
    });
    const holder = sql.begin(async (tx) => {
      await tx.unsafe(
        "SELECT 1 FROM public.money_periods WHERE id=$1 FOR UPDATE",
        [nFirstSuccessor.id],
      );
      markHolderReady();
      await holderRelease;
    });
    await holderReady;

    const routineWait = beginAs(N, "f04-lock-routine", (tx) =>
      recordRoutine(tx, {
        bookingDate: addDays(today, -30),
        amountMinor: 1600,
        category: "household",
        needVsWant: "need",
        idempotencyKey: "money-f04-n-lock-routine",
        fingerprint: hex("d"),
      }),
    );
    await waitForLockWait("f04-lock-routine");

    const rolloverWait = beginAs(N, "f04-lock-rollover", (tx) =>
      callRollover(tx, [
        nSourceId,
        nSourceVersion,
        nFirstSuccessor.start_date,
        nFirstSuccessor.end_date,
        nFirstSuccessor.start_date,
        "Africa/Casablanca",
        "initialized",
        false,
        100000,
        nSourceEnd,
        null,
        "Finalized after review",
        hex("d"),
        {
          opening: {
            source: "carry_forward",
            recordedAt: `${nFirstSuccessor.start_date}T09:00:00.000Z`,
            cutoffDate: nSourceEnd,
            evidence: null,
            note: "Finalized after review",
            corrections: [],
          },
          createdFrom: "web",
        },
        null,
        "f04-n-lock-rollover",
        hex("e"),
        "carry_forward",
        null,
        null,
        null,
        "Reviewed every unverified day",
        (Date.parse(nSourceEnd) - Date.parse(nSourceStart)) / 86_400_000 + 1,
        { modeledClosingCashMinor: 100000, pendingOccurrenceCount: 0 },
        [],
        [],
        `${nFirstSuccessor.start_date}T09:00:00.000Z`,
      ]),
    );
    await waitForLockWait("f04-lock-rollover");
    releaseHolder();

    const settled = await Promise.allSettled([holder, routineWait, rolloverWait]);
    const deadlocked = settled.some(
      (entry) =>
        entry.status === "rejected" &&
        entry.reason &&
        entry.reason.code === "40P01",
    );
    assert(!deadlocked, "continuation and adoption do not deadlock under the shared lock order");
    assert(
      settled[1].status === "fulfilled" || settled[2].status === "fulfilled",
      "at least one synchronized continuation/adoption transaction completes",
    );
    const nPeriods = await sql.unsafe(
      `SELECT count(*)::int n, count(*) FILTER (WHERE lifecycle='tracking')::int tracking
       FROM public.money_periods WHERE owner_user_id=$1`,
      [N],
    );
    assert(
      nPeriods[0].tracking === 1,
      "the synchronized writes leave exactly one tracking period",
    );
    console.log("[LOCK] routine write and rollover adoption serialize without deadlock");

    // --- A carried opening cutoff is exactly the source end -----------------
    const oSourceStart = addDays(today, -40);
    const oSourceEnd = addDays(today, -11);
    const oCreated = await user(O, (tx) =>
      createPeriod(tx, oSourceStart, oSourceEnd, oSourceStart, 100000),
    );
    const oSourceId = oCreated[0].id;
    await user(O, (tx) =>
      recordRoutine(tx, {
        bookingDate: today,
        amountMinor: 1800,
        category: "household",
        needVsWant: "need",
        idempotencyKey: "money-f04-o-continuation",
        fingerprint: hex("c"),
      }),
    );
    const oSuccessor = (
      await sql.unsafe(
        "SELECT * FROM public.money_periods WHERE owner_user_id=$1 AND lifecycle='tracking'",
        [O],
      )
    )[0];
    const oSourceVersion = (
      await sql.unsafe("SELECT version FROM public.money_periods WHERE id=$1", [
        oSourceId,
      ])
    )[0].version;
    const oRolloverArgs = (cutoffDate, operationId) => [
      oSourceId,
      oSourceVersion,
      oSuccessor.start_date,
      oSuccessor.end_date,
      oSuccessor.start_date,
      "Africa/Casablanca",
      "initialized",
      false,
      100000,
      cutoffDate,
      null,
      "Finalized after review",
      hex("d"),
      {
        opening: {
          source: "carry_forward",
          recordedAt: `${oSuccessor.start_date}T09:00:00.000Z`,
          cutoffDate,
          evidence: null,
          note: "Finalized after review",
          corrections: [],
        },
        createdFrom: "web",
      },
      null,
      operationId,
      hex("e"),
      "carry_forward",
      null,
      null,
      null,
      "Reviewed every unverified day",
      (Date.parse(oSourceEnd) - Date.parse(oSourceStart)) / 86_400_000 + 1,
      { modeledClosingCashMinor: 100000, pendingOccurrenceCount: 0 },
      [],
      [],
      `${oSuccessor.start_date}T09:00:00.000Z`,
    ];

    let oCutoffMismatchDenied = false;
    try {
      await user(O, (tx) =>
        callRollover(
          tx,
          oRolloverArgs(oSuccessor.start_date, "f04-o-carry-cutoff-mismatch"),
        ),
      );
    } catch (error) {
      oCutoffMismatchDenied =
        error.code === "23514" && /source period end/.test(error.message);
    }
    assert(
      oCutoffMismatchDenied,
      "a carried opening cutoff that is not the source end is refused",
    );
    const oBlocked = await sql.unsafe(
      `SELECT
         (SELECT count(*)::int FROM public.money_period_rollovers
           WHERE owner_user_id=$1 AND source_period_id=$2) AS receipts,
         (SELECT lifecycle FROM public.money_periods WHERE id=$2) AS source_lifecycle,
         (SELECT lifecycle FROM public.money_periods WHERE id=$3) AS successor_lifecycle,
         (SELECT initialization FROM public.money_periods WHERE id=$3) AS successor_initialization,
         (SELECT jsonb_typeof(provenance -> 'opening') FROM public.money_periods WHERE id=$3) AS successor_opening_type`,
      [O, oSourceId, oSuccessor.id],
    );
    assert(
      oBlocked[0].receipts === 0 &&
        oBlocked[0].source_lifecycle === "superseded" &&
        oBlocked[0].successor_lifecycle === "tracking" &&
        oBlocked[0].successor_initialization === "uninitialized" &&
        oBlocked[0].successor_opening_type === "null",
      "the carried cutoff mismatch leaves the source, successor and receipt unchanged",
    );

    await user(O, (tx) =>
      callRollover(tx, oRolloverArgs(oSourceEnd, "f04-o-carry-cutoff-valid")),
    );
    const oAfter = await sql.unsafe(
      `SELECT
         (SELECT count(*)::int FROM public.money_period_rollovers
           WHERE owner_user_id=$1 AND source_period_id=$2) AS receipts,
         initialization,
         provenance -> 'opening' ->> 'cutoffDate' AS cutoff
       FROM public.money_periods WHERE id=$3`,
      [O, oSourceId, oSuccessor.id],
    );
    assert(
      oAfter[0].receipts === 1 &&
        oAfter[0].initialization === "initialized" &&
        oAfter[0].cutoff === oSourceEnd,
      "a carried opening with the exact source end cutoff is retained",
    );
    console.log("[CARRY] a carried opening cutoff must equal the source period end");

    // --- A final-day close continues into the next month -------------------
    // The explicit close ends the source on its final day. A later routine
    // write must still continue the calendar, leaving the ended source (and its
    // retained close evidence) untouched. Finalization then adopts that exact
    // successor instead of creating a second period.
    const pSourceStart = addDays(today, -40);
    const pSourceEnd = addDays(today, -11);
    const pCreated = await user(P, (tx) =>
      createPeriod(
        tx,
        pSourceStart,
        pSourceEnd,
        pSourceStart,
        100000,
        undefined,
        "initialized",
        { savingsTargetMinor: 12000, emergencyTargetMinor: 3000 },
      ),
    );
    const pSourceId = pCreated[0].id;
    await user(P, (tx) =>
      tx.unsafe("SELECT public.money_rebase_day_start_baseline($1::uuid)", [
        pSourceId,
      ]),
    );
    const pBeforeMove = (
      await sql.unsafe("SELECT version FROM public.money_periods WHERE id=$1", [
        pSourceId,
      ])
    )[0];
    await user(P, (tx) =>
      tx.unsafe(
        `SELECT * FROM public.money_update_period(
          $1::uuid,$2::integer,$3::date,NULL::jsonb,NULL::integer,NULL::text,
          NULL::text,NULL::jsonb,NULL::text,now()::timestamptz
        )`,
        [pSourceId, pBeforeMove.version, pSourceEnd],
      ),
    );
    const pBeforeClose = (
      await sql.unsafe("SELECT version FROM public.money_periods WHERE id=$1", [
        pSourceId,
      ])
    )[0];
    const pClosed = await user(P, (tx) =>
      tx.unsafe(
        `SELECT public.money_close_day(
          $1::uuid,$2::integer,$3::date,$4::text,$5::uuid,$6::text,$7::uuid[],$8::timestamptz
        ) AS result`,
        [
          pSourceId,
          pBeforeClose.version,
          pSourceEnd,
          "Final day closed",
          "a0000000-0000-4000-8000-0000000000f1",
          hex("f"),
          [],
          `${pSourceEnd}T20:00:00.000Z`,
        ],
      ),
    );
    assert(
      pClosed[0].result.status === "closed" &&
        pClosed[0].result.period.lifecycle === "ended",
      "the final-day close ends the source with retained evidence",
    );
    const pEndedVersion = pClosed[0].result.period.version;
    const pBookingDate = addDays(pSourceEnd, 1);
    const pRoutine = await user(P, (tx) =>
      recordRoutine(tx, {
        bookingDate: pBookingDate,
        amountMinor: 2100,
        category: "groceries",
        needVsWant: "need",
        idempotencyKey: "money-f04-p-ended-continuation",
        fingerprint: hex("a"),
      }),
    );
    const pPeriods = await sql.unsafe(
      `SELECT id, lifecycle, start_date, end_date, active_date, successor_period_id,
              finalization_reference, rolled_over_at, version
       FROM public.money_periods WHERE owner_user_id=$1 ORDER BY start_date`,
      [P],
    );
    assert(pPeriods.length === 2, "the ended source creates exactly one successor");
    const pSourceRow = pPeriods.find((row) => row.id === pSourceId);
    const pSuccessor = pPeriods.find((row) => row.lifecycle === "tracking");
    assert(
      pSourceRow.lifecycle === "ended" &&
        pSourceRow.successor_period_id === null &&
        pSourceRow.finalization_reference === null &&
        pSourceRow.rolled_over_at === null &&
        pSourceRow.version === pEndedVersion,
      "the ended source stays ended with no forged finalization evidence",
    );
    assert(
      pSuccessor &&
        pSuccessor.start_date === pBookingDate &&
        pSuccessor.end_date === endOfMonth(pBookingDate) &&
        pRoutine[0].period_id === pSuccessor.id,
      "the routine expense lands in the one contiguous tracking successor",
    );
    const pEvidence = await sql.unsafe(
      `SELECT
         (SELECT count(*)::int FROM public.money_day_closes WHERE owner_user_id=$1 AND period_id=$2) AS closes,
         (SELECT close_fingerprint FROM public.money_day_closes WHERE owner_user_id=$1 AND period_id=$2) AS fingerprint,
         (SELECT count(*)::int FROM public.personal_expenses WHERE owner_user_id=$1 AND period_id=$3 AND kind='opening') AS successor_openings`,
      [P, pSourceId, pSuccessor.id],
    );
    assert(
      pEvidence[0].closes === 1 &&
        pEvidence[0].fingerprint === hex("f") &&
        pEvidence[0].successor_openings === 0,
      "continuation invents no close or opening and leaves the close fingerprint unchanged",
    );

    // A retry in the continued range never creates a second successor.
    await user(P, (tx) =>
      recordRoutine(tx, {
        bookingDate: pBookingDate,
        amountMinor: 2200,
        category: "household",
        needVsWant: "need",
        idempotencyKey: "money-f04-p-ended-continuation-retry",
        fingerprint: hex("b"),
      }),
    );
    const pPeriodCount = await sql.unsafe(
      "SELECT count(*)::int n FROM public.money_periods WHERE owner_user_id=$1",
      [P],
    );
    assert(pPeriodCount[0].n === 2, "the retry reuses the same successor");
    const pSuccessorMovements = await sql.unsafe(
      `SELECT count(*)::int n FROM public.personal_expenses
       WHERE owner_user_id=$1 AND period_id=$2 AND kind <> 'opening' AND deleted_at IS NULL`,
      [P, pSuccessor.id],
    );

    // Finalizing the continuation before the ended predecessor would orphan the
    // predecessor's adoption path, so it is blocked exactly like a superseded
    // predecessor.
    const pSuccessorVersion = (
      await sql.unsafe("SELECT version FROM public.money_periods WHERE id=$1", [
        pSuccessor.id,
      ])
    )[0].version;
    let pSuccessorFirstBlocked = false;
    try {
      await user(P, (tx) =>
        callRollover(tx, [
          pSuccessor.id,
          pSuccessorVersion,
          addDays(pSuccessor.end_date, 1),
          addDays(pSuccessor.end_date, 20),
          addDays(pSuccessor.end_date, 1),
          "Africa/Casablanca",
          "initialized",
          false,
          0,
          pSuccessor.end_date,
          null,
          null,
          hex("d"),
          {},
          null,
          "f04-p-successor-first",
          hex("e"),
          "carry_forward",
          null,
          null,
          null,
          null,
          0,
          {},
          [],
          [],
          `${addDays(pSuccessor.end_date, 1)}T09:00:00.000Z`,
        ]),
      );
    } catch (error) {
      pSuccessorFirstBlocked =
        error.code === "23514" && /preceding period/.test(error.message);
    }
    assert(
      pSuccessorFirstBlocked,
      "an ended predecessor must be finalized before its tracking successor",
    );

    // Finalization from the ended source adopts the exact continuation range.
    const pSummary = (
      await user(P, (tx) =>
        tx.unsafe(
          "SELECT public.money_rollover_close_snapshot_summary($1::uuid) AS summary",
          [pSourceId],
        ),
      )
    )[0].summary;
    const pRolloverArgs = (endDate, operationId) => [
      pSourceId,
      pEndedVersion,
      pSuccessor.start_date,
      endDate,
      pSuccessor.start_date,
      "Africa/Casablanca",
      "initialized",
      false,
      100000,
      pSourceEnd,
      null,
      "Finalized after review",
      hex("d"),
      {
        opening: {
          source: "carry_forward",
          recordedAt: `${pSuccessor.start_date}T09:00:00.000Z`,
          cutoffDate: pSourceEnd,
          evidence: null,
          note: "Finalized after review",
          corrections: [],
        },
        createdFrom: "web",
      },
      null,
      operationId,
      hex("e"),
      "carry_forward",
      null,
      null,
      "Savings target versus transfers reviewed",
      "Reviewed every unverified day",
      pSummary.unverifiedDayCount,
      { modeledClosingCashMinor: 100000, pendingOccurrenceCount: 0 },
      [],
      [],
      `${pSuccessor.start_date}T09:00:00.000Z`,
    ];
    let pRangeConflict = false;
    try {
      await user(P, (tx) =>
        callRollover(
          tx,
          pRolloverArgs(
            addDays(pSuccessor.end_date, 1),
            "f04-p-ended-range-mismatch",
          ),
        ),
      );
    } catch (error) {
      pRangeConflict = error.code === "40001" &&
        /exactly that range/.test(error.message);
    }
    assert(
      pRangeConflict,
      "an ended-source rollover adopts only the exact continuation range",
    );
    const pAdopted = await user(P, (tx) =>
      callRollover(tx, pRolloverArgs(pSuccessor.end_date, "f04-p-ended-adopt")),
    );
    assert(
      pAdopted[0].result.rollover.successor_period_id === pSuccessor.id,
      "finalization adopts the continuation successor",
    );
    const pAfterAdoption = await sql.unsafe(
      `SELECT
         (SELECT count(*)::int FROM public.money_periods WHERE owner_user_id=$1) AS periods,
         (SELECT lifecycle FROM public.money_periods WHERE id=$2) AS source_lifecycle,
         (SELECT successor_period_id FROM public.money_periods WHERE id=$2) AS source_successor,
         (SELECT finalization_reference FROM public.money_periods WHERE id=$2) AS source_reference,
         (SELECT lifecycle FROM public.money_periods WHERE id=$3) AS successor_lifecycle,
         (SELECT count(*)::int FROM public.personal_expenses
           WHERE owner_user_id=$1 AND period_id=$3 AND kind='opening' AND deleted_at IS NULL) AS successor_openings,
         (SELECT amount_minor FROM public.personal_expenses
           WHERE owner_user_id=$1 AND period_id=$3 AND kind='opening' AND deleted_at IS NULL) AS successor_opening_amount,
         (SELECT count(*)::int FROM public.personal_expenses
           WHERE owner_user_id=$1 AND period_id=$3 AND kind <> 'opening' AND deleted_at IS NULL) AS successor_movements,
         (SELECT count(*)::int FROM public.money_day_closes
           WHERE owner_user_id=$1 AND period_id=$2) AS source_closes,
         (SELECT count(*)::int FROM public.money_period_rollovers
           WHERE owner_user_id=$1 AND source_period_id=$2) AS receipts`,
      [P, pSourceId, pSuccessor.id],
    );
    assert(
      pAfterAdoption[0].periods === 2 &&
        pAfterAdoption[0].source_lifecycle === "rolled_over" &&
        pAfterAdoption[0].source_successor === pSuccessor.id &&
        pAfterAdoption[0].source_reference === pSuccessor.id &&
        pAfterAdoption[0].successor_lifecycle === "tracking" &&
        pAfterAdoption[0].successor_openings === 1 &&
        pAfterAdoption[0].successor_opening_amount === 100000 &&
        pAfterAdoption[0].successor_movements === pSuccessorMovements[0].n &&
        pAfterAdoption[0].source_closes === 1 &&
        pAfterAdoption[0].receipts === 1,
      "adoption links the ended source, keeps one successor/opening and its recorded movements",
    );
    console.log("[ENDED] a final-day close continues into the next month and is adopted without duplication");

    // --- Gap limit ----------------------------------------------------------
    await user(B, (tx) =>
      createPeriod(
        tx,
        addDays(today, -800),
        addDays(today, -400),
        addDays(today, -800),
        100000,
      ),
    );
    let gapDenied = false;
    try {
      await user(B, (tx) =>
        recordRoutine(tx, {
          bookingDate: addDays(today, -10),
          amountMinor: 1900,
          category: "coffee",
          idempotencyKey: "money-f04-gap",
          fingerprint: hex("e"),
        }),
      );
    } catch (error) {
      gapDenied = error.code === "23514" && /366 days/.test(error.message);
    }
    assert(gapDenied, "a gap larger than 366 days requires explicit period creation");
    const bPeriodsAfterGap = await sql.unsafe(
      "SELECT count(*)::int n FROM public.money_periods WHERE owner_user_id=$1",
      [B],
    );
    assert(bPeriodsAfterGap[0].n === 1, "the refused gap creates no period");

    console.log("MONEY-001-A period-continuity proof passed");
  } catch (error) {
    console.error(error);
    exit(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

await main();
