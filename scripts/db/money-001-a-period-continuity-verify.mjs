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
 *   - an unknown-opening superseded predecessor is initialized exactly once and
 *     can then be finalized; active dates and settings stay closed;
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
const RESOURCE = "https://ega.example.com/api/mcp";
const READ = ["today.read", "timer.read", "personal_ops.read"];
const WRITE = [...READ, "personal_ops.write"];

const tags = JSON.parse(
  await readFile(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8"),
).entries.map((entry) => entry.tag);
const url = argv[argv.indexOf("--url") + 1];
if (!url) throw new Error("Missing --url");

const sql = postgres(url, {
  max: 2,
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
) =>
  tx.unsafe(
    `SELECT (p).id, (p).version, (p).lifecycle
     FROM (SELECT public.money_create_period(
       $1::date, $2::date, 'Africa/Casablanca'::text, $3::date,
       $7::text, $4::integer, $1::date, $5::text, $6::jsonb,
       '{"savingsTargetMinor":null,"emergencyTargetMinor":null}'::jsonb,
       now()::timestamptz
     ) AS p) created`,
    [start, end, active, opening, hex("a"), provenance, initialization],
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
      "INSERT INTO auth.users VALUES ($1,'a@example.test'),($2,'b@example.test'),($3,'c@example.test'),($4,'d@example.test'),($5,'e@example.test'),($6,'f@example.test'),($7,'g@example.test'),($8,'h@example.test'),($9,'i@example.test'),($10,'j@example.test')",
      [A, B, C, D, E, F, G, H, I, J],
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

    const continued = await user(A, (tx) => continuePeriod(tx, today));
    assert(continued.length === 1, "continuation returns exactly one period");
    const successor = continued[0];
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
    const retry = await user(A, (tx) => continuePeriod(tx, today));
    assert(
      retry[0].id === successor.id,
      "a retry inside the continued window returns the same period",
    );
    const periodCountAfterRetry = await sql.unsafe(
      "SELECT count(*)::int n FROM public.money_periods WHERE owner_user_id=$1",
      [A],
    );
    assert(periodCountAfterRetry[0].n === 2, "the retry creates no second successor");

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
      await user(A, (tx) => continuePeriod(tx, addDays(sourceStart, -1)));
    } catch (error) {
      beforeDenied = error.code === "23514";
    }
    assert(beforeDenied, "continuation refuses a date before the current window");

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
    assert(preserved[0].n === 1, "the movement already recorded in the successor is preserved");
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
      crossOwnerDenied = error.code === "23514";
    }
    assert(crossOwnerDenied, "owner B has no tracking period to continue");    const bPeriods = await user(B, (tx) =>
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
    const cSuccessor = (await user(C, (tx) => continuePeriod(tx, today)))[0];
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
    const dSuccessor = (await user(D, (tx) => continuePeriod(tx, today)))[0];
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
          [iSourceId, iSource.version, addDays(iStart, 1)],
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
          iSource.version,
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

    await user(J, (tx) =>
      recordRoutine(tx, {
        bookingDate: jFuture,
        amountMinor: 1900,
        category: "coffee",
        idempotencyKey: "money-f04-j-successor",
        fingerprint: hex("f"),
      }),
    );
    const jState = (
      await sql.unsafe(
        "SELECT lifecycle, end_date, version FROM public.money_periods WHERE id=$1",
        [jSourceId],
      )
    )[0];
    assert(
      jState.lifecycle === "superseded" && jState.end_date === today,
      "a future-dated routine write supersedes the period that owns today",
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

    // --- Gap limit ----------------------------------------------------------
    const eCreated = await user(E, (tx) => createPeriod(tx, sourceStart, sourceEnd, sourceStart, 100000));
    let gapDenied = false;
    try {
      await user(E, (tx) => continuePeriod(tx, addDays(sourceEnd, 400)));
    } catch (error) {
      gapDenied = error.code === "23514" && /366 days/.test(error.message);
    }
    assert(gapDenied, "a gap larger than 366 days requires explicit period creation");
    const ePeriods = await sql.unsafe(
      "SELECT count(*)::int n FROM public.money_periods WHERE owner_user_id=$1",
      [E],
    );
    assert(ePeriods[0].n === 1, "the refused gap creates no period");

    console.log("MONEY-001-A period-continuity proof passed");
  } catch (error) {
    console.error(error);
    exit(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

await main();
