import { describe, expect, it, vi } from "vitest";

const query = {
  select: vi.fn(() => query),
  eq: vi.fn(() => query),
  order: vi.fn(() => query),
  range: vi.fn(),
};

const createClient = vi.hoisted(() =>
  vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: "user-1" } },
        error: null,
      })),
    },
    from: vi.fn(() => query),
  })),
);

vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/monitoring/capture-server-exception", () => ({
  captureServerException: vi.fn(),
}));

import { GET } from "./route";

describe("GET /timer/export", () => {
  beforeEach(() => {
    query.select.mockClear();
    query.eq.mockClear();
    query.order.mockClear();
    query.range.mockReset();
    createClient.mockClear();
  });

  it("returns 401 when unauthenticated", async () => {
    createClient.mockResolvedValueOnce({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: null }, error: new Error("no session") })),
      },
      from: vi.fn(() => query),
    } as never);

    const response = await GET();
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("Unauthorized.");
  });

  it("scopes task_sessions by owner_user_id", async () => {
    query.range.mockResolvedValueOnce({ data: [], error: null });

    await GET();

    expect(query.eq).toHaveBeenCalledWith("owner_user_id", "user-1");
  });

  it("pages beyond 1000 rows and sets content-disposition", async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) => ({
      id: `session-${index}`,
      task_id: "task-1",
      started_at: "2026-04-18T09:00:00.000Z",
      ended_at: null,
      duration_seconds: null,
      created_at: "2026-04-18T09:00:00.000Z",
      updated_at: "2026-04-18T09:00:00.000Z",
      tasks: null,
    }));
    const secondPage = Array.from({ length: 500 }, (_, index) => ({
      id: `session-${500 + index}`,
      task_id: "task-1",
      started_at: "2026-04-18T09:00:00.000Z",
      ended_at: null,
      duration_seconds: null,
      created_at: "2026-04-18T09:00:00.000Z",
      updated_at: "2026-04-18T09:00:00.000Z",
      tasks: null,
    }));
    const thirdPage = Array.from({ length: 250 }, (_, index) => ({
      id: `session-${1000 + index}`,
      task_id: "task-1",
      started_at: "2026-04-18T09:00:00.000Z",
      ended_at: null,
      duration_seconds: null,
      created_at: "2026-04-18T09:00:00.000Z",
      updated_at: "2026-04-18T09:00:00.000Z",
      tasks: null,
    }));

    query.range
      .mockResolvedValueOnce({ data: firstPage, error: null })
      .mockResolvedValueOnce({ data: secondPage, error: null })
      .mockResolvedValueOnce({ data: thirdPage, error: null });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(response.headers.get("content-disposition")).toContain("timer-sessions.csv");
    expect(query.range).toHaveBeenNthCalledWith(1, 0, 499);
    expect(query.range).toHaveBeenNthCalledWith(2, 500, 999);
    expect(query.range).toHaveBeenNthCalledWith(3, 1000, 1499);
  });

  it("returns 500 instead of a partial CSV when a later page fails", async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) => ({
      id: `session-${index}`,
      task_id: "task-1",
      started_at: "2026-04-18T09:00:00.000Z",
      ended_at: null,
      duration_seconds: null,
      created_at: "2026-04-18T09:00:00.000Z",
      updated_at: "2026-04-18T09:00:00.000Z",
      tasks: null,
    }));

    query.range
      .mockResolvedValueOnce({ data: firstPage, error: null })
      .mockResolvedValueOnce({ data: null, error: new Error("db failure") });

    const response = await GET();
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Unable to export timer sessions right now.");
  });
});