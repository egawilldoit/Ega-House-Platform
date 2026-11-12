import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MONEY-06 web actions at the real boundary: verified identity selects the
 * owner, invalid input never reaches persistence, a failed mutation redirects
 * with an actionable error instead of claiming success, and scheduling never
 * posts cash.
 */

class RedirectSentinel extends Error {
  constructor(readonly location: string) {
    super(location);
  }
}

const repositoryCalls: Array<{ method: string; input: unknown }> = [];
let currentUser: { id: string } | null = { id: "user-1" };
let occurrenceState: "pending" | "paid" = "pending";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (location: string) => {
    throw new RedirectSentinel(location);
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ marker: "client" })),
}));

vi.mock("@/lib/services/auth-service", () => ({
  getCurrentUser: vi.fn(async () => currentUser),
}));

vi.mock("@ega/data-access", () => {
  class SupabaseObligationRepository {
    async findByIdempotencyKey(actor: { userId: string }, key: string) {
      repositoryCalls.push({
        method: "findByIdempotencyKey",
        input: { actor, key },
      });
      return { ok: true, value: null };
    }
    async create(actor: { userId: string }, input: { values: Record<string, unknown> }) {
      repositoryCalls.push({ method: "create", input: { actor, values: input.values } });
      return {
        ok: true,
        value: {
          id: "22222222-2222-4222-8222-222222222222",
          ...input.values,
          state: "pending",
          stateReason: null,
          paymentExpenseId: null,
          paymentEvidence: null,
          version: 1,
          createdAt: "2026-11-11T09:00:00.000Z",
          updatedAt: "2026-11-11T09:00:00.000Z",
        },
      };
    }
    async get(actor: { userId: string }, id: string) {
      repositoryCalls.push({ method: "get", input: { actor, id } });
      return {
        ok: true,
        value: {
          id,
          kind: "bill",
          description: "Rent",
          amountMinor: 350000,
          currency: "MAD",
          periodStart: "2026-11-01",
          periodEnd: "2026-11-30",
          dueDate: "2026-11-05",
          needVsWant: null,
          purpose: "fixed",
          countsInDaily: false,
          category: "bills",
          state: occurrenceState,
          stateEffectiveDate: "2026-11-01",
          stateReason: null,
          paymentExpenseId:
            occurrenceState === "paid"
              ? "33333333-3333-4333-8333-333333333333"
              : null,
          paymentEvidence: null,
          templateId: null,
          idempotencyKey: "occurrence-1",
          version: 1,
          createdAt: "2026-11-01T09:00:00.000Z",
          updatedAt: "2026-11-01T09:00:00.000Z",
        },
      };
    }
    async transition() {
      repositoryCalls.push({ method: "transition", input: null });
      return { ok: false as const, error: { code: "conflict" as const } };
    }
    async getTemplate() {
      return { ok: true as const, value: null };
    }
    async findTemplateByIdempotencyKey() {
      return { ok: true as const, value: null };
    }
    async createTemplate() {
      return { ok: false as const, error: { code: "unknown" as const } };
    }
  }
  return { SupabaseObligationRepository };
});

const {
  createObligationFormAction,
  transitionObligationFormAction,
} = await import("./obligations-actions");

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

async function captureRedirect(run: () => Promise<void>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof RedirectSentinel) return error.location;
    throw error;
  }
  throw new Error("Expected a redirect.");
}

beforeEach(() => {
  repositoryCalls.length = 0;
  currentUser = { id: "user-1" };
  occurrenceState = "pending";
});

describe("MONEY-06 obligation web actions", () => {
  it("redirects to login when there is no verified session", async () => {
    currentUser = null;
    const location = await captureRedirect(() =>
      createObligationFormAction(
        form({
          returnTo: "/money/bills",
          kind: "bill",
          description: "Rent",
          amount: "3500.00",
          dueDate: "2026-11-05",
          stateEffectiveDate: "2026-11-11",
          idempotencyKey: "web-1",
        }),
      ),
    );
    expect(location).toContain("/login");
    expect(repositoryCalls).toHaveLength(0);
  });

  it("rejects an invalid amount before persistence and never claims success", async () => {
    const location = await captureRedirect(() =>
      createObligationFormAction(
        form({
          returnTo: "/money/bills",
          kind: "bill",
          description: "Rent",
          amount: "3500.555",
          dueDate: "2026-11-05",
          stateEffectiveDate: "2026-11-11",
          idempotencyKey: "web-1",
        }),
      ),
    );
    expect(location).toContain("error=");
    expect(location).not.toContain("notice=");
    expect(repositoryCalls).toHaveLength(0);
  });

  it("creates a pending occurrence for the verified owner with integer centimes", async () => {
    const location = await captureRedirect(() =>
      createObligationFormAction(
        form({
          returnTo: "/money/bills",
          kind: "bill",
          description: "Rent",
          amount: "3500.00",
          dueDate: "2026-11-05",
          periodStart: "2026-11-01",
          periodEnd: "2026-11-30",
          needVsWant: "",
          purpose: "",
          countsInDaily: "",
          category: "",
          stateEffectiveDate: "2026-11-11",
          idempotencyKey: "web-1",
        }),
      ),
    );

    expect(location).toContain("/money/bills?notice=");
    expect(location).toContain("No+cash+movement");
    const create = repositoryCalls.find((call) => call.method === "create");
    const values = (create?.input as { values: Record<string, unknown> }).values;
    expect(values.amountMinor).toBe(350000);
    expect(values.needVsWant).toBeNull();
    expect(values.purpose).toBe("fixed");
    expect(values.countsInDaily).toBe(false);
    expect(values.category).toBe("bills");
    expect(values.stateEffectiveDate).toBe("2026-11-11");
    const actor = (create?.input as { actor: { userId: string } }).actor;
    expect(actor.userId).toBe("user-1");
  });

  it("surfaces the MONEY-07 refusal when asked to mark a bill paid", async () => {
    const location = await captureRedirect(() =>
      transitionObligationFormAction(
        form({
          returnTo: "/money/bills",
          obligationId: "22222222-2222-4222-8222-222222222222",
          version: "1",
          to: "paid",
          effectiveDate: "2026-11-11",
        }),
      ),
    );
    expect(location).toContain("error=");
    expect(decodeURIComponent(location)).toMatch(/MONEY-07/);
  });
});
