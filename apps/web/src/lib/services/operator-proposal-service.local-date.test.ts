import assert from "node:assert/strict";
import test from "node:test";
import { beforeEach, vi } from "vitest";

const listProposals = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({})),
}));

vi.mock("@/lib/services/auth-service", () => ({
  requireAuthenticatedUser: vi.fn(async () => ({ id: "user-1" })),
}));

vi.mock("@ega/application", () => ({
  applyApprovedOperatorProposal: vi.fn(),
  approveOperatorProposal: vi.fn(),
  createAuthenticatedActor: vi.fn(() => ({ userId: "user-1" })),
  createOperatorProposal: vi.fn(),
  dismissOperatorProposal: vi.fn(),
  getOperatorStoredProposal: vi.fn(),
  resolveTimeContext: vi.fn(),
}));

vi.mock("@ega/data-access", () => ({
  SupabaseOperatorProposalRepository: vi.fn(function () {
    return { listProposals };
  }),
  SupabaseTasksRepository: vi.fn(function () {
    return {};
  }),
  SupabaseTimeContextRepository: vi.fn(function () {
    return {};
  }),
}));

import { getActiveOperatorProposalData } from "./operator-proposal-service";

function proposal(id: string, localDate: string, status: string, createdAt: string) {
  return { id, localDate, status, createdAt };
}

beforeEach(() => {
  vi.clearAllMocks();
  listProposals.mockImplementation(async (_actor: unknown, filter: { localDate?: string; status?: string }) => {
    const records = [
      proposal("yesterday-approved", "2026-11-21", "approved", "2026-11-21T09:00:00Z"),
      proposal("yesterday-generated", "2026-11-21", "generated", "2026-11-21T10:00:00Z"),
      proposal("today-approved", "2026-11-22", "approved", "2026-11-22T08:00:00Z"),
      proposal("today-generated", "2026-11-22", "generated", "2026-11-22T09:00:00Z"),
    ];
    return {
      ok: true,
      value: records.filter(
        (record) => record.localDate === filter.localDate && record.status === filter.status,
      ),
    };
  });
});

test("reopening a plan only returns proposals for the requested local date", async () => {
  const result = await getActiveOperatorProposalData({ localDate: "2026-11-22" });

  assert.equal(result.errorMessage, null);
  assert.equal(result.data?.id, "today-generated");
  assert.equal(listProposals.mock.calls.length, 2);
  for (const [, filter] of listProposals.mock.calls) {
    assert.equal(filter.localDate, "2026-11-22");
  }
});

test("a plan left over from yesterday is not recoverable after midnight", async () => {
  const result = await getActiveOperatorProposalData({ localDate: "2026-11-23" });

  assert.equal(result.data, null);
  for (const [, filter] of listProposals.mock.calls) {
    assert.equal(filter.localDate, "2026-11-23");
  }
});
