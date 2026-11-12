import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MONEY-07 web payment actions at the real boundary: the verified session
 * selects the owner, an invalid amount or a missing need/want never reaches
 * persistence, and a refused write redirects with an actionable error instead
 * of claiming that cash moved.
 */

class RedirectSentinel extends Error {
  constructor(readonly location: string) {
    super(location);
  }
}

const repositoryCalls: Array<{ method: string; input: unknown }> = [];
let currentUser: { id: string } | null = { id: "user-1" };
let occurrenceState: "pending" | "paid" = "pending";
let paymentOutcome: "ok" | "conflict" = "ok";

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
    async get(actor: { userId: string }, id: string) {
      repositoryCalls.push({ method: "get", input: { actor, id } });
      return {
        ok: true as const,
        value: {
          id,
          kind: "bill",
          description: "Rent",
          amountMinor: 350000,
          currency: "MAD",
          periodStart: "2026-11-01",
          periodEnd: "2026-11-30",
          dueDate: "2026-11-05",
          needVsWant: "need",
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
          version: occurrenceState === "paid" ? 2 : 1,
          createdAt: "2026-11-11T09:00:00.000Z",
          updatedAt: "2026-11-11T09:00:00.000Z",
        },
      };
    }
  }
  class SupabaseObligationPaymentRepository {
    async pay(actor: { userId: string }, input: Record<string, unknown>) {
      repositoryCalls.push({ method: "pay", input: { actor, ...input } });
      if (paymentOutcome === "conflict") {
        return { ok: false as const, error: { code: "conflict" as const } };
      }
      return {
        ok: true as const,
        value: {
          occurrence: {
            id: "22222222-2222-4222-8222-222222222222",
            state: "paid",
            version: 2,
            paymentExpenseId: "33333333-3333-4333-8333-333333333333",
          },
          payment: {
            expenseId: "33333333-3333-4333-8333-333333333333",
            amountMinor: 350000,
            currency: "MAD",
            bookingDate: "2026-11-05",
            countsInDaily: false,
            needVsWant: "need",
            paymentMethod: "cash",
            purpose: "fixed",
            category: "bills",
          },
          replayed: false,
        },
      };
    }
    async correct(actor: { userId: string }, input: Record<string, unknown>) {
      repositoryCalls.push({ method: "correct", input: { actor, ...input } });
      if (paymentOutcome === "conflict") {
        return { ok: false as const, error: { code: "conflict" as const } };
      }
      return {
        ok: true as const,
        value: {
          occurrence: { id: "22222222-2222-4222-8222-222222222222", state: "paid" },
          payment: null,
          replayed: false,
        },
      };
    }
    async undo(actor: { userId: string }, input: Record<string, unknown>) {
      repositoryCalls.push({ method: "undo", input: { actor, ...input } });
      if (paymentOutcome === "conflict") {
        return { ok: false as const, error: { code: "conflict" as const } };
      }
      return {
        ok: true as const,
        value: {
          occurrence: { id: "22222222-2222-4222-8222-222222222222", state: "pending" },
          payment: null,
          replayed: false,
        },
      };
    }
  }
  return { SupabaseObligationRepository, SupabaseObligationPaymentRepository };
});

const {
  correctObligationPaymentFormAction,
  payObligationFormAction,
  undoObligationPaymentFormAction,
} = await import("./obligation-payment-actions");

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
  paymentOutcome = "ok";
});

describe("MONEY-07 obligation payment web actions", () => {
  it("redirects to login without a verified session", async () => {
    currentUser = null;
    const location = await captureRedirect(() =>
      payObligationFormAction(
        form({
          returnTo: "/money/bills",
          obligationId: "22222222-2222-4222-8222-222222222222",
          version: "1",
          bookingDate: "2026-11-05",
          needVsWant: "need",
          operationId: "op-1",
        }),
      ),
    );
    expect(location).toContain("/login");
    expect(repositoryCalls).toHaveLength(0);
  });

  it("refuses a payment without need/want before persistence", async () => {
    const location = await captureRedirect(() =>
      payObligationFormAction(
        form({
          returnTo: "/money/bills",
          obligationId: "22222222-2222-4222-8222-222222222222",
          version: "1",
          bookingDate: "2026-11-05",
          needVsWant: "",
          operationId: "op-1",
        }),
      ),
    );
    expect(location).toContain("error=");
    expect(location).not.toContain("notice=");
    expect(repositoryCalls).toHaveLength(0);
  });

  it("refuses a stale form without an operation id", async () => {
    const location = await captureRedirect(() =>
      payObligationFormAction(
        form({
          returnTo: "/money/bills",
          obligationId: "22222222-2222-4222-8222-222222222222",
          version: "1",
          bookingDate: "2026-11-05",
          needVsWant: "need",
          operationId: "",
        }),
      ),
    );
    expect(location).toContain("error=");
    expect(repositoryCalls).toHaveLength(0);
  });

  it("records one payment for the verified owner and reports the cash effect", async () => {
    const location = await captureRedirect(() =>
      payObligationFormAction(
        form({
          returnTo: "/money/bills",
          obligationId: "22222222-2222-4222-8222-222222222222",
          version: "1",
          bookingDate: "2026-11-05",
          needVsWant: "need",
          countsInDaily: "",
          paymentMethod: "cash",
          operationId: "op-1",
        }),
      ),
    );

    expect(location).toContain("/money/bills?notice=");
    expect(location).toContain("Payment+recorded");
    const pay = repositoryCalls.find((call) => call.method === "pay");
    const input = pay?.input as {
      actor: { userId: string };
      occurrenceId: string;
      expectedVersion: number;
      bookingDate: string;
      idempotencyKey: string;
      needVsWant: string;
      countsInDaily: boolean;
      operationId: string;
    };
    expect(input.actor.userId).toBe("user-1");
    expect(input.occurrenceId).toBe("22222222-2222-4222-8222-222222222222");
    expect(input.expectedVersion).toBe(1);
    expect(input.bookingDate).toBe("2026-11-05");
    expect(input.idempotencyKey).toBe("obligation-payment:op-1");
    expect(input.needVsWant).toBe("need");
    expect(input.countsInDaily).toBe(false);
    expect(input.operationId).toBe("op-1");
  });

  it("surfaces a refused payment as an error, never as a success notice", async () => {
    paymentOutcome = "conflict";
    const location = await captureRedirect(() =>
      payObligationFormAction(
        form({
          returnTo: "/money/subscriptions",
          obligationId: "22222222-2222-4222-8222-222222222222",
          version: "1",
          bookingDate: "2026-11-05",
          needVsWant: "need",
          operationId: "op-1",
        }),
      ),
    );
    expect(location).toContain("/money/subscriptions?error=");
    expect(location).not.toContain("notice=");
  });

  it("corrects a linked payment with integer centimes", async () => {
    occurrenceState = "paid";
    const location = await captureRedirect(() =>
      correctObligationPaymentFormAction(
        form({
          returnTo: "/money/bills",
          obligationId: "22222222-2222-4222-8222-222222222222",
          version: "2",
          amount: "3550.00",
          bookingDate: "2026-11-06",
          countsInDaily: "false",
          operationId: "op-2",
        }),
      ),
    );

    expect(location).toContain("/money/bills?notice=");
    expect(location).toContain("Payment+corrected");
    const correct = repositoryCalls.find((call) => call.method === "correct");
    const input = correct?.input as {
      amountMinor: number;
      bookingDate: string;
      countsInDaily: boolean;
      operationId: string;
    };
    expect(input.amountMinor).toBe(355000);
    expect(input.bookingDate).toBe("2026-11-06");
    expect(input.countsInDaily).toBe(false);
    expect(input.operationId).toBe("op-2");
  });

  it("rejects an invalid correction amount before persistence", async () => {
    const location = await captureRedirect(() =>
      correctObligationPaymentFormAction(
        form({
          returnTo: "/money/bills",
          obligationId: "22222222-2222-4222-8222-222222222222",
          version: "2",
          amount: "3550.555",
          bookingDate: "2026-11-06",
          operationId: "op-2",
        }),
      ),
    );
    expect(location).toContain("error=");
    expect(repositoryCalls).toHaveLength(0);
  });

  it("undoes a linked payment and reports the restored reserve", async () => {
    occurrenceState = "paid";
    const location = await captureRedirect(() =>
      undoObligationPaymentFormAction(
        form({
          returnTo: "/money/bills",
          obligationId: "22222222-2222-4222-8222-222222222222",
          version: "2",
          operationId: "op-3",
        }),
      ),
    );

    expect(location).toContain("/money/bills?notice=");
    expect(location).toContain("Payment+undone");
    const undo = repositoryCalls.find((call) => call.method === "undo");
    const input = undo?.input as {
      occurrenceId: string;
      expectedVersion: number;
      operationId: string;
    };
    expect(input.occurrenceId).toBe("22222222-2222-4222-8222-222222222222");
    expect(input.expectedVersion).toBe(2);
    expect(input.operationId).toBe("op-3");
  });
});
