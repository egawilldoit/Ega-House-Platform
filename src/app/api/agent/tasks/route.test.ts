import { describe, it, expect, vi } from "vitest";

vi.mock("@/db/client", () => ({
  db: {},
}));

vi.mock("@/lib/services/agent-token-repository", () => {
  const mockRepo = {
    findByPrefix: vi.fn(),
    insertToken: vi.fn(),
    updateLastUsedAt: vi.fn(),
    revokeToken: vi.fn(),
  };
  const MockDrizzleTokenRepository = function () {
    return mockRepo;
  };
  return { DrizzleTokenRepository: MockDrizzleTokenRepository };
});

vi.mock("next/server", async () => {
  const actual = await vi.importActual("next/server");
  return {
    ...(actual as Record<string, unknown>),
    after: vi.fn((fn: () => void) => fn()),
  };
});

import { GET as GET_TASKS } from "@/app/api/agent/tasks/route";

describe("GET /api/agent/tasks (route integration)", () => {
  it("exports a GET handler", () => {
    expect(GET_TASKS).toBeInstanceOf(Function);
  });

  it("returns 401 without auth header", async () => {
    const request = new Request("http://localhost:3000/api/agent/tasks");
    const response = await GET_TASKS(request);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("UNAUTHENTICATED");
  });
});
