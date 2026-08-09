import { describe, it, expect, vi } from "vitest";

vi.mock("@/db/client", () => ({
  db: {},
}));

vi.mock("@/lib/services/agent-token-repository", () => {
  // All mock state must be defined inside the factory (hoisted context)
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

import { GET as GET_PROJECTS } from "@/app/api/agent/projects/route";

describe("GET /api/agent/projects (route integration)", () => {
  it("exports a GET handler", () => {
    expect(GET_PROJECTS).toBeInstanceOf(Function);
  });

  it("returns 401 without auth header", async () => {
    const request = new Request("http://localhost:3000/api/agent/projects");
    const response = await GET_PROJECTS(request);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("UNAUTHENTICATED");
  });
});
