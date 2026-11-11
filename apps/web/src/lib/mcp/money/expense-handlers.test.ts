import { describe, expect, it } from "vitest";

import type {
  AuthenticatedActor,
  ExpenseRepository,
} from "@ega/application";
import type {
  ExpenseCategory,
  ExpenseCreateValues,
  PersonalExpense,
} from "@ega/domain/expenses";

import { createMcpAuthInfo } from "@/lib/mcp/auth-info";
import { createMcpMoneyExpenseHandlers } from "@/lib/mcp/money/expense-handlers";
import type { McpPrincipal } from "@/lib/mcp/principal";

const OPERATION_ID = "650e8400-e29b-41d4-a716-446655440000";
const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER_OWNER = "22222222-2222-4222-8222-222222222222";

const WRITER: McpPrincipal = {
  ownerUserId: OWNER,
  oauthClientId: "chatgpt-client",
  grantId: "10000000-0000-0000-0000-000000000001",
  permissionProfile: "personal_operations_writer",
  permissionsVersion: 1,
  permissions: [
    "today.read",
    "timer.read",
    "personal_ops.read",
    "personal_ops.write",
  ],
};

const READER: McpPrincipal = {
  ...WRITER,
  permissionProfile: "personal_operations",
  permissions: ["today.read", "timer.read", "personal_ops.read"],
};

const writerAuth = createMcpAuthInfo("writer-token", WRITER);
const readerAuth = createMcpAuthInfo("reader-token", READER);

type StoredRow = {
  ownerUserId: string;
  createFingerprint: string;
  expense: PersonalExpense;
};

/**
 * In-memory canonical repository honoring the same owner filter, soft-delete,
 * version and idempotency-replay semantics the Supabase adapter enforces at the
 * boundary. Deleted rows remain findable by idempotency key, exactly like the
 * real unique index.
 */
function createRepository() {
  const byId = new Map<string, StoredRow>();
  const byOwnerKey = new Map<string, StoredRow>();
  let sequence = 0;

  function nextId() {
    sequence += 1;
    return `11111111-1111-4111-8111-${String(sequence).padStart(12, "0")}`;
  }

  function ownerRow(actor: AuthenticatedActor, id: string) {
    const row = byId.get(id);
    return row && row.ownerUserId === actor.userId ? row : null;
  }

  const repository: ExpenseRepository = {
    async findByIdempotencyKey(actor, idempotencyKey) {
      const row = byOwnerKey.get(`${actor.userId}::${idempotencyKey}`);
      if (!row) return { ok: true, value: null };
      return {
        ok: true,
        value: {
          expense: row.expense,
          createFingerprint: row.createFingerprint,
        },
      };
    },
    async create(actor, input) {
      if (
        byOwnerKey.has(`${actor.userId}::${input.values.idempotencyKey}`)
      ) {
        return { ok: false, error: { code: "conflict" } };
      }
      const now = new Date().toISOString();
      const expense: PersonalExpense = {
        id: nextId(),
        kind: "expense",
        direction: "out",
        occurredAt: input.values.occurredAt,
        bookingDate: input.values.bookingDate,
        amountMinor: input.values.amountMinor,
        currency: "MAD",
        category: input.values.category,
        note: input.values.note,
        merchant: input.values.merchant,
        needVsWant: input.values.needVsWant,
        paymentMethod: input.values.paymentMethod,
        purpose: null,
        countsInDaily: true,
        periodId: null,
        idempotencyKey: input.values.idempotencyKey,
        version: 1,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      const row = {
        ownerUserId: actor.userId,
        createFingerprint: input.createFingerprint,
        expense,
      };
      byId.set(expense.id, row);
      byOwnerKey.set(`${actor.userId}::${input.values.idempotencyKey}`, row);
      return { ok: true, value: expense };
    },
    async get(actor, id) {
      const row = ownerRow(actor, id);
      return {
        ok: true,
        value: row && row.expense.deletedAt === null ? row.expense : null,
      };
    },
    async list(actor, query) {
      const rows = [...byId.values()]
        .filter((row) => row.ownerUserId === actor.userId)
        .filter((row) => row.expense.deletedAt === null)
        .filter(
          (row) =>
            (query.startUtcIso === null
              || row.expense.occurredAt >= query.startUtcIso)
            && (query.endUtcExclusiveIso === null
              || row.expense.occurredAt < query.endUtcExclusiveIso),
        )
        .map((row) => row.expense)
        .sort((left, right) => {
          if (left.occurredAt !== right.occurredAt) {
            return left.occurredAt < right.occurredAt ? 1 : -1;
          }
          return left.id < right.id ? 1 : -1;
        });
      return {
        ok: true,
        value: rows.slice(query.offset, query.offset + query.limit),
      };
    },
    async update(actor, id, input) {
      const row = ownerRow(actor, id);
      if (!row || row.expense.deletedAt !== null) {
        return { ok: false, error: { code: "notFound" } };
      }
      if (row.expense.version !== input.expectedVersion) {
        return { ok: false, error: { code: "conflict" } };
      }
      const next: PersonalExpense = {
        ...row.expense,
        ...input.changes,
        version: row.expense.version + 1,
        updatedAt: input.updatedAt,
      };
      row.expense = next;
      return { ok: true, value: next };
    },
    async softDelete(actor, id, nowIso, expectedVersion) {
      const row = ownerRow(actor, id);
      if (!row) return { ok: false, error: { code: "notFound" } };
      if (row.expense.deletedAt !== null) {
        return {
          ok: true,
          value: {
            id,
            deletedAt: row.expense.deletedAt,
            alreadyDeleted: true,
          },
        };
      }
      if (
        expectedVersion !== undefined
        && row.expense.version !== expectedVersion
      ) {
        return { ok: false, error: { code: "conflict" } };
      }
      row.expense = {
        ...row.expense,
        deletedAt: nowIso,
        updatedAt: nowIso,
        version: row.expense.version + 1,
      };
      return {
        ok: true,
        value: { id, deletedAt: nowIso, alreadyDeleted: false },
      };
    },
    async summarize() {
      return {
        ok: true,
        value: {
          totalsByCategory: {},
          countsByCategory: {},
          recordCount: 0,
          truncated: false,
        },
      };
    },
    async count() {
      return { ok: true as const, value: 0 };
    },
  };

  return repository;
}

function createHandlers(repository: ExpenseRepository = createRepository()) {
  return createMcpMoneyExpenseHandlers({
    createUserClient: () => ({}) as never,
    repositoryFactory: () => repository,
    timeContextRepositoryFactory: () =>
      ({
        async getTimezone() {
          return { ok: true as const, value: "Africa/Casablanca" };
        },
        async setTimezone() {
          return { ok: true as const, value: "Africa/Casablanca" };
        },
      }) as never,
    // No active period in these unit fixtures: the guard is a no-op.
    periodRepositoryFactory: () =>
      ({
        async findTracking() {
          return { ok: true as const, value: null };
        },
        async list() {
          return { ok: true as const, value: [] };
        },
      }) as never,
  });
}

type ToolPayload = {
  ok: boolean;
  error?: { code: string; message: string };
  expense?: PersonalExpense;
  expenses?: PersonalExpense[];
  pagination?: {
    limit: number;
    offset: number;
    hasMore: boolean;
    nextOffset: number | null;
  };
  replayed?: boolean;
  alreadyDeleted?: boolean;
  id?: string;
};

function structured(result: { structuredContent?: unknown }): ToolPayload {
  return result.structuredContent as ToolPayload;
}

async function createCoffee(
  handlers: ReturnType<typeof createHandlers>,
  overrides: Partial<ExpenseCreateValues> = {},
) {
  const input = {
    occurredAt: "2026-11-11T09:15:00.000Z",
    amountMinor: 1100,
    category: "coffee" as ExpenseCategory,
    needVsWant: "want" as const,
    note: "morning coffee",
    merchant: "Cafe",
    paymentMethod: "cash" as const,
    idempotencyKey: "coffee-1",
    operationId: OPERATION_ID,
    ...overrides,
  };
  const result = await handlers.createMoneyExpense(writerAuth, input);
  return { result, payload: structured(result), input };
}

describe("MCP Money expense handlers", () => {
  it("creates, reads, edits and deletes the same canonical id", async () => {
    const handlers = createHandlers();
    const created = await createCoffee(handlers);

    expect(created.payload.ok).toBe(true);
    const id = created.payload.expense!.id;
    expect(created.payload.expense!.amountMinor).toBe(1100);
    expect(created.payload.expense!.version).toBe(1);

    const read = structured(await handlers.getMoneyExpense(writerAuth, { expenseId: id }));
    expect(read.ok).toBe(true);
    expect(read.expense!.id).toBe(id);

    const updated = structured(
      await handlers.updateMoneyExpense(writerAuth, {
        expenseId: id,
        expectedVersion: 1,
        amountMinor: 1200,
        note: "edited manually",
        operationId: "750e8400-e29b-41d4-a716-446655440000",
      }),
    );
    expect(updated.ok).toBe(true);
    expect(updated.expense!.id).toBe(id);
    expect(updated.expense!.amountMinor).toBe(1200);
    expect(updated.expense!.version).toBe(2);

    const deleted = structured(
      await handlers.deleteMoneyExpense(writerAuth, {
        expenseId: id,
        expectedVersion: 2,
        operationId: "850e8400-e29b-41d4-a716-446655440000",
      }),
    );
    expect(deleted.ok).toBe(true);
    expect(deleted.alreadyDeleted).toBe(false);

    const afterDelete = structured(
      await handlers.getMoneyExpense(writerAuth, { expenseId: id }),
    );
    expect(afterDelete.ok).toBe(false);
    expect(afterDelete.error!.code).toBe("NOT_FOUND");
  });

  it("rejects a stale edit without overwriting the current row", async () => {
    const handlers = createHandlers();
    const created = await createCoffee(handlers);
    const id = created.payload.expense!.id;

    const first = structured(
      await handlers.updateMoneyExpense(writerAuth, {
        expenseId: id,
        expectedVersion: 1,
        note: "first edit",
        operationId: "750e8400-e29b-41d4-a716-446655440001",
      }),
    );
    expect(first.ok).toBe(true);

    const stale = structured(
      await handlers.updateMoneyExpense(writerAuth, {
        expenseId: id,
        expectedVersion: 1,
        note: "stale overwrite",
        operationId: "750e8400-e29b-41d4-a716-446655440002",
      }),
    );
    expect(stale.ok).toBe(false);
    expect(stale.error!.code).toBe("CONFLICT");

    const current = structured(
      await handlers.getMoneyExpense(writerAuth, { expenseId: id }),
    );
    expect(current.expense!.note).toBe("first edit");
    expect(current.expense!.version).toBe(2);
  });

  it("does not recreate a purchase when a create replays after deletion", async () => {
    const handlers = createHandlers();
    const created = await createCoffee(handlers);
    const id = created.payload.expense!.id;

    await handlers.deleteMoneyExpense(writerAuth, {
      expenseId: id,
      expectedVersion: 1,
      operationId: "850e8400-e29b-41d4-a716-446655440001",
    });

    const replay = await createCoffee(handlers);
    expect(replay.payload.ok).toBe(true);
    expect(replay.payload.replayed).toBe(true);
    expect(replay.payload.expense!.id).toBe(id);
    expect(replay.payload.expense!.deletedAt).not.toBeNull();

    const again = structured(
      await handlers.deleteMoneyExpense(writerAuth, {
        expenseId: id,
        expectedVersion: 2,
        operationId: "850e8400-e29b-41d4-a716-446655440002",
      }),
    );
    expect(again.ok).toBe(true);
    expect(again.alreadyDeleted).toBe(true);
  });

  it("exposes every page through offset with stable newest-first ordering", async () => {
    const handlers = createHandlers();
    for (const [index, key] of ["a", "b", "c"].entries()) {
      await createCoffee(handlers, {
        idempotencyKey: `page-${key}`,
        occurredAt: `2026-11-1${index}T09:00:00.000Z`,
      });
    }

    const first = structured(
      await handlers.listMoneyLedger(writerAuth, { limit: 2, offset: 0 }),
    );
    expect(first.ok).toBe(true);
    expect(first.expenses!).toHaveLength(2);
    expect(first.pagination).toEqual({
      limit: 2,
      offset: 0,
      hasMore: true,
      nextOffset: 2,
    });
    expect(first.expenses![0].occurredAt > first.expenses![1].occurredAt).toBe(true);

    const second = structured(
      await handlers.listMoneyLedger(writerAuth, { limit: 2, offset: 2 }),
    );
    expect(second.expenses!).toHaveLength(1);
    expect(second.pagination).toEqual({
      limit: 2,
      offset: 2,
      hasMore: false,
      nextOffset: null,
    });
    expect(second.expenses![0].id).not.toBe(first.expenses![0].id);
  });

  it("returns actionable invalid date and timezone errors", async () => {
    const handlers = createHandlers();

    const badDate = structured(
      await handlers.listMoneyLedger(writerAuth, { from: "2026-13-40" }),
    );
    expect(badDate.ok).toBe(false);
    expect(badDate.error!.code).toBe("INVALID_ARGUMENT");
    expect(badDate.error!.message).toContain("YYYY-MM-DD");

    const badTimezone = structured(
      await handlers.listMoneyLedger(writerAuth, {
        from: "2026-11-01",
        to: "2026-11-11",
        timezone: "Mars/Olympus",
      }),
    );
    expect(badTimezone.ok).toBe(false);
    expect(badTimezone.error!.code).toBe("INVALID_ARGUMENT");
    expect(badTimezone.error!.message).toContain("IANA timezone");
  });

  it("denies Money writes to a reader grant and cross-owner reads", async () => {
    const handlers = createHandlers();
    const created = await createCoffee(handlers);
    const id = created.payload.expense!.id;

    const denied = structured(
      await handlers.updateMoneyExpense(readerAuth, {
        expenseId: id,
        expectedVersion: 1,
        note: "not allowed",
        operationId: "750e8400-e29b-41d4-a716-446655440003",
      }),
    );
    expect(denied.ok).toBe(false);
    expect(denied.error!.code).toBe("PERMISSION_DENIED");

    const otherOwner = createMcpAuthInfo("other-token", {
      ...WRITER,
      ownerUserId: OTHER_OWNER,
      oauthClientId: "other-client",
    });
    const foreign = structured(
      await handlers.getMoneyExpense(otherOwner, { expenseId: id }),
    );
    expect(foreign.ok).toBe(false);
    expect(foreign.error!.code).toBe("NOT_FOUND");
  });
});
