import { describe, expect, it, vi } from "vitest";

function makeChain(result: unknown) {
  const chain: Record<string, any> = {};
  for (const method of ["select", "eq", "gte", "lt", "order"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

const createClient = vi.hoisted(() =>
  vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: "user-1" } },
        error: null,
      })),
    },
    from: vi.fn(),
  })),
);

vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/monitoring/capture-server-exception", () => ({
  captureServerException: vi.fn(),
}));
vi.mock("@/lib/services/time-context-service", () => ({
  getWebTimeContext: vi.fn(async () => {
    throw new Error("no time context in test");
  }),
}));

import { GET } from "./route";

describe("GET /review/export", () => {
  it("returns 401 when unauthenticated", async () => {
    createClient.mockResolvedValueOnce({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: null }, error: new Error("no session") })),
      },
      from: vi.fn(),
    } as never);

    const response = await GET(new Request("http://localhost/review/export"));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("Unauthorized.");
  });

  it("scopes all relevant queries by owner_user_id and preserves selected week CSV", async () => {
    const chains: Record<string, any[]> = {
      week_reviews: [],
      tasks: [],
      task_sessions: [],
      goals: [],
    };

    const results: Record<string, unknown> = {
      week_reviews: {
        data: [
          {
            id: "review-1",
            week_start: "2026-04-13",
            week_end: "2026-04-19",
            summary: "Closed the loop",
            wins: "Ship export",
            blockers: "None",
            next_steps: "Keep momentum",
            created_at: "2026-04-18T10:00:00.000Z",
            updated_at: "2026-04-18T11:00:00.000Z",
          },
        ],
        error: null,
      },
      tasks: { data: null, error: null, count: 3 },
      task_sessions: {
        data: [
          {
            task_id: "task-1",
            started_at: "2026-04-14T09:00:00.000Z",
            ended_at: "2026-04-14T10:00:00.000Z",
            duration_seconds: null,
          },
        ],
        error: null,
      },
      goals: { data: [{ status: "active" }, { status: "paused" }], error: null },
    };

    createClient.mockResolvedValueOnce({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } }, error: null })),
      },
      from: vi.fn((table: string) => {
        const chain = makeChain(results[table]);
        chains[table].push(chain);
        return chain;
      }),
    } as never);

    const response = await GET(new Request("http://localhost/review/export?weekOf=2026-04-13"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain('filename="review-2026-04-13.csv"');

    const csv = await response.text();
    expect(csv).toContain("review-1,2026-04-13,2026-04-19,Closed the loop");

    for (const table of ["week_reviews", "tasks", "task_sessions", "goals"]) {
      const hasOwnerFilter = chains[table].some((chain) =>
        chain.eq.mock.calls.some((args: unknown[]) => args[0] === "owner_user_id" && args[1] === "user-1"),
      );
      expect(hasOwnerFilter).toBe(true);
    }
  });
});