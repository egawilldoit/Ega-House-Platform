import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";

/**
 * MONEY-02 update/soft-delete invariant proof against a real Postgres.
 *
 * Opt-in (`MONEY_TEST_DATABASE_URL`) because it executes RLS and triggers on a
 * live server. It runs inside one transaction and always rolls back. The target
 * database must already have the full journal applied; this proof does not
 * replay migrations or destroy the database.
 */

const connectionString = process.env.MONEY_TEST_DATABASE_URL;
const RESOURCE = "https://ega.example.com/api/mcp";

function assertSafeTarget(url: string | undefined): void {
  if (!url) return;
  const host = new URL(url).hostname;
  const local =
    host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  if (!local && process.env.MONEY_TEST_ALLOW_NONLOCAL !== "1") {
    throw new Error(
      "MONEY_TEST_DATABASE_URL points at a remote host. Set MONEY_TEST_ALLOW_NONLOCAL=1 only for an approved rolled-back proof target.",
    );
  }
}

class RollbackProof extends Error {}

function claims(owner: string, clientId: string | null) {
  return JSON.stringify(
    clientId
      ? { sub: owner, role: "authenticated", client_id: clientId, aud: RESOURCE }
      : { sub: owner, role: "authenticated", aud: "authenticated" },
  );
}

describe.skipIf(!connectionString)("MONEY-02 expense update invariants", () => {
  const sql = postgres(connectionString!, { max: 1, prepare: false });
  afterAll(async () => {
    await sql.end();
  });

  it("enforces version progression, immutable identity and no undelete", async () => {
    assertSafeTarget(connectionString);
    const owner = randomUUID();
    const otherOwner = randomUUID();
    const writerClient = `writer-${randomUUID()}`;
    const readerClient = `reader-${randomUUID()}`;
    const expenseId = randomUUID();
    const idempotencyKey = `proof-${randomUUID()}`;
    const state: Record<string, unknown> = {};

    const readPermissions = ["today.read", "timer.read", "personal_ops.read"];
    const writePermissions = [...readPermissions, "personal_ops.write"];

    try {
      await sql.begin(async (tx) => {
        await tx`
          insert into public.personal_expenses
            (id, owner_user_id, occurred_at, amount_minor, currency, category,
             note, merchant, need_vs_want, payment_method, idempotency_key,
             create_fingerprint)
          values
            (${expenseId}, ${owner}, '2026-11-11T09:00:00.000Z', 1100, 'MAD',
             'coffee', 'proof', null, 'want', null, ${idempotencyKey},
             ${"a".repeat(64)})
        `;

        const seedGrant = async (
          clientId: string,
          profile: string,
          permissions: string[],
        ) => {
          await tx`
            insert into public.mcp_authorization_grants
              (owner_user_id, oauth_client_id, resource_uri, client_name, status,
               permission_profile, permissions, permissions_version, approved_at)
            values
              (${owner}, ${clientId}, ${RESOURCE}, 'Proof client', 'active',
               ${profile}, ${tx.json(permissions)}, 1, now())
          `;
        };
        await seedGrant(writerClient, "personal_operations_writer", writePermissions);
        await seedGrant(readerClient, "personal_operations", readPermissions);

        const asUser = async (ownerId: string, clientId: string | null) => {
          await tx`reset role`;
          await tx`set local role authenticated`;
          await tx`select set_config('request.jwt.claims', ${claims(ownerId, clientId)}, true)`;
        };

        const expectRejected = async (
          statement: () => Promise<unknown>,
          code: string,
        ): Promise<boolean> => {
          await tx.unsafe("savepoint expected_rejection");
          try {
            await statement();
          } catch (error) {
            const actual = (error as { code?: string }).code;
            await tx.unsafe("rollback to savepoint expected_rejection");
            return actual === code;
          }
          await tx.unsafe("release savepoint expected_rejection");
          return false;
        };

        // Writer: a versioned update advances exactly one version.
        await asUser(owner, writerClient);
        const updated = await tx`
          update public.personal_expenses
          set amount_minor = 1200, version = version + 1, updated_at = now()
          where id = ${expenseId} and version = 1
          returning id, version
        `;
        state.updated = updated.length;

        // Stale expected version: zero rows, newer value is preserved.
        const stale = await tx`
          update public.personal_expenses
          set amount_minor = 9999, version = version + 1, updated_at = now()
          where id = ${expenseId} and version = 1
          returning id
        `;
        const current = await tx`
          select amount_minor, version from public.personal_expenses
          where id = ${expenseId}
        `;
        state.staleRows = stale.length;
        state.amountAfterStale = Number(current[0].amount_minor);
        state.versionAfterStale = Number(current[0].version);

        // Immutable creation identity cannot be rewritten by an OAuth client.
        state.immutableRejected = await expectRejected(
          () => tx`
            update public.personal_expenses
            set idempotency_key = ${`changed-${randomUUID()}`},
                version = version + 1, updated_at = now()
            where id = ${expenseId}
          `,
          "23514",
        );

        // Version must advance by exactly one.
        state.versionJumpRejected = await expectRejected(
          () => tx`
            update public.personal_expenses
            set version = version + 2, updated_at = now()
            where id = ${expenseId}
          `,
          "23514",
        );

        // Soft delete advances the version and records the terminal timestamp.
        const deleted = await tx`
          update public.personal_expenses
          set deleted_at = now(), updated_at = now(), version = version + 1
          where id = ${expenseId} and version = 2 and deleted_at is null
          returning id, version, deleted_at
        `;
        state.deleted = deleted.length;

        // No undelete / post-delete mutation.
        state.undeleteRejected = await expectRejected(
          () => tx`
            update public.personal_expenses
            set deleted_at = null, version = version + 1, updated_at = now()
            where id = ${expenseId}
          `,
          "23514",
        );

        // Replaying the create key after deletion cannot recreate the row.
        state.replayRejected = await expectRejected(
          () => tx`
            insert into public.personal_expenses
              (owner_user_id, occurred_at, amount_minor, currency, category,
               need_vs_want, idempotency_key, create_fingerprint)
            values
              (${owner}, '2026-11-11T09:00:00.000Z', 1100, 'MAD', 'coffee',
               'want', ${idempotencyKey}, ${"a".repeat(64)})
          `,
          "23505",
        );

        // Reader grant cannot mutate; cross-owner writer sees no row.
        await asUser(owner, readerClient);
        const readerUpdate = await tx`
          update public.personal_expenses
          set amount_minor = 1300, version = version + 1, updated_at = now()
          where id = ${expenseId}
          returning id
        `;
        state.readerUpdate = readerUpdate.length;

        await asUser(otherOwner, writerClient);
        const crossOwner = await tx`
          update public.personal_expenses
          set amount_minor = 1400, version = version + 1, updated_at = now()
          where id = ${expenseId}
          returning id
        `;
        state.crossOwnerUpdate = crossOwner.length;

        throw new RollbackProof();
      });
    } catch (error) {
      if (!(error instanceof RollbackProof)) throw error;
    }

    expect(state.updated).toBe(1);
    expect(state.staleRows).toBe(0);
    expect(state.amountAfterStale).toBe(1200);
    expect(state.versionAfterStale).toBe(2);
    expect(state.immutableRejected).toBe(true);
    expect(state.versionJumpRejected).toBe(true);
    expect(state.deleted).toBe(1);
    expect(state.undeleteRejected).toBe(true);
    expect(state.replayRejected).toBe(true);
    expect(state.readerUpdate).toBe(0);
    expect(state.crossOwnerUpdate).toBe(0);

    const leftovers = await sql`
      select count(*)::int as n
      from public.personal_expenses
      where id = ${expenseId}
    `;
    expect(leftovers[0].n).toBe(0);
  }, 60_000);
});
