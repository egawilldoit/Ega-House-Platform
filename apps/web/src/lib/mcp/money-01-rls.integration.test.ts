import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";

/**
 * MONEY-01 authorization proof against a real Postgres/Supabase database.
 *
 * This test is opt-in (`MONEY_TEST_DATABASE_URL`) because it executes RLS
 * against a live server. It runs every statement inside one transaction and
 * always rolls back, so no owner, grant or expense row survives the proof.
 *
 * It synthesizes Supabase's `authenticated` role and the custom-access-token
 * claims (`sub`, `client_id`, `aud`) so the policies evaluate exactly as they
 * do for an OAuth/MCP token, and then verifies direct-user behavior separately.
 */

const connectionString = process.env.MONEY_TEST_DATABASE_URL;
const RESOURCE = "https://ega.example.com/api/mcp";

class RollbackProof extends Error {}

function claims(owner: string, clientId: string | null) {
  return JSON.stringify(
    clientId
      ? { sub: owner, role: "authenticated", client_id: clientId, aud: RESOURCE }
      : { sub: owner, role: "authenticated", aud: "authenticated" },
  );
}

describe.skipIf(!connectionString)("MONEY-01 finance grant RLS", () => {
  const sql = postgres(connectionString!, { max: 1, prepare: false });
  afterAll(async () => {
    await sql.end();
  });

  it("allows only the matching active read/write grant and keeps owners isolated", async () => {
    const owner = randomUUID();
    const otherOwner = randomUUID();
    const writerClient = `writer-${randomUUID()}`;
    const readerClient = `reader-${randomUUID()}`;
    const revokedClient = `revoked-${randomUUID()}`;
    const wrongResourceClient = `wrong-resource-${randomUUID()}`;
    const workspaceClient = `workspace-${randomUUID()}`;
    const expenseId = randomUUID();
    const otherExpenseId = randomUUID();

    const state: Record<string, unknown> = {};

    try {
      await sql.begin(async (tx) => {
        const seedExpense = async (
          id: string,
          ownerId: string,
          amount: number,
        ) => {
          await tx`
            insert into public.personal_expenses
              (id, owner_user_id, occurred_at, amount_minor, currency, category,
               note, merchant, need_vs_want, payment_method, idempotency_key,
               create_fingerprint)
            values
              (${id}, ${ownerId}, '2026-11-11T09:00:00.000Z', ${amount}, 'MAD',
               'coffee', 'RLS proof', null, 'want', null, ${`proof-${id}`},
               ${"a".repeat(64)})
          `;
        };

        await seedExpense(expenseId, owner, 1100);
        await seedExpense(otherExpenseId, otherOwner, 2200);

        const seedGrant = async (
          clientId: string,
          profile: string,
          permissions: string[],
          status = "active",
          resource = RESOURCE,
          ownerId = owner,
        ) => {
          await tx`
            insert into public.mcp_authorization_grants
              (owner_user_id, oauth_client_id, resource_uri, client_name, status,
               permission_profile, permissions, permissions_version,
               approved_at, revoked_at)
            values
              (${ownerId}, ${clientId}, ${resource}, 'Proof client', ${status},
               ${profile}, ${tx.json(permissions)}, 1,
               ${status === "active" ? new Date().toISOString() : null}::timestamptz,
               ${status === "revoked" ? new Date().toISOString() : null}::timestamptz)
          `;
        };

        const readPermissions = ["today.read", "timer.read", "personal_ops.read"];
        const writePermissions = [...readPermissions, "personal_ops.write"];

        await seedGrant(writerClient, "personal_operations_writer", writePermissions);
        await seedGrant(readerClient, "personal_operations", readPermissions);
        await seedGrant(revokedClient, "personal_operations_writer", writePermissions, "revoked");
        await seedGrant(
          wrongResourceClient,
          "personal_operations_writer",
          writePermissions,
          "active",
          "https://other.example.com/api/mcp",
        );
        await seedGrant(workspaceClient, "workspace_manager", [
          "projects.read",
          "projects.create",
          "projects.update",
          "goals.read",
          "goals.create",
          "goals.update",
          "tasks.read",
          "tasks.create",
          "tasks.update",
          "today.read",
          "today.update",
          "timer.read",
          "timer.create",
          "timer.update",
        ]);

        const asUser = async (ownerId: string, clientId: string | null) => {
          await tx`set local role authenticated`;
          await tx`select set_config('request.jwt.claims', ${claims(ownerId, clientId)}, true)`;
        };

        // A denied RLS statement aborts the surrounding transaction, so each
        // expected rejection runs behind a savepoint.
        const expectDenied = async (
          statement: () => Promise<unknown>,
        ): Promise<boolean> => {
          await tx.unsafe("savepoint expected_denial");
          try {
            await statement();
          } catch {
            await tx.unsafe("rollback to savepoint expected_denial");
            return true;
          }
          await tx.unsafe("release savepoint expected_denial");
          return false;
        };

        // Writer grant: reads and writes the canonical row.
        await asUser(owner, writerClient);
        const writerRows = await tx`
          select id from public.personal_expenses where id = ${expenseId}`;
        const writerInsert = await tx`
          insert into public.personal_expenses
            (owner_user_id, occurred_at, amount_minor, currency, category,
             need_vs_want, idempotency_key, create_fingerprint)
          values
            (${owner}, '2026-11-11T10:00:00.000Z', 2500, 'MAD', 'groceries',
             'need', ${`writer-${randomUUID()}`}, ${"b".repeat(64)})
          returning id`;
        state.writerRead = writerRows.length;
        state.writerInsert = writerInsert.length;

        // Reader grant: reads but cannot insert.
        await tx`reset role`;
        await asUser(owner, readerClient);
        const readerRows = await tx`
          select id from public.personal_expenses where id = ${expenseId}`;
        state.readerRead = readerRows.length;
        state.readerInsertDenied = await expectDenied(() => tx`
          insert into public.personal_expenses
            (owner_user_id, occurred_at, amount_minor, currency, category,
             need_vs_want, idempotency_key, create_fingerprint)
          values
            (${owner}, '2026-11-11T10:00:00.000Z', 999, 'MAD', 'coffee',
             'want', ${`reader-${randomUUID()}`}, ${"c".repeat(64)})`);

        // Revoked, wrong-resource, workspace_only and wrong-client deny.
        for (const [key, clientId, ownerId] of [
          ["revoked", revokedClient, owner],
          ["wrongResource", wrongResourceClient, owner],
          ["workspaceOnly", workspaceClient, owner],
          ["wrongClient", `unknown-${randomUUID()}`, owner],
          ["crossOwner", writerClient, otherOwner],
        ] as const) {
          await tx`reset role`;
          await asUser(ownerId, clientId);
          const rows = await tx`
            select id from public.personal_expenses
            where id in (${expenseId}, ${otherExpenseId})`;
          state[key] = rows.length;
        }

        // Direct user (no client_id) keeps owner-scoped access even with a
        // grant present for that owner.
        await tx`reset role`;
        await asUser(owner, null);
        const directRows = await tx`
          select id from public.personal_expenses where id = ${expenseId}`;
        state.directRead = directRows.length;

        // An invalid profile/permission union is rejected by the constraint.
        await tx`reset role`;
        state.invalidUnionRejected = await expectDenied(() => tx`
          insert into public.mcp_authorization_grants
            (owner_user_id, oauth_client_id, resource_uri, status,
             permission_profile, permissions)
          values
            (${owner}, ${`bad-${randomUUID()}`}, ${RESOURCE}, 'active',
             'workspace_money_reader',
             ${tx.json([...readPermissions, "personal_ops.write"])})`);

        throw new RollbackProof();
      });
    } catch (error) {
      if (!(error instanceof RollbackProof)) throw error;
    }

    expect(state.writerRead).toBe(1);
    expect(state.writerInsert).toBe(1);
    expect(state.readerRead).toBe(1);
    expect(state.readerInsertDenied).toBe(true);
    expect(state.revoked).toBe(0);
    expect(state.wrongResource).toBe(0);
    expect(state.workspaceOnly).toBe(0);
    expect(state.wrongClient).toBe(0);
    expect(state.crossOwner).toBe(0);
    expect(state.directRead).toBe(1);
    expect(state.invalidUnionRejected).toBe(true);

    // The rollback left no proof rows behind.
    const leftovers = await sql`
      select count(*)::int as n
      from public.mcp_authorization_grants
      where oauth_client_id in (${writerClient}, ${readerClient}, ${revokedClient})`;
    expect(leftovers[0].n).toBe(0);
  }, 60_000);
});
