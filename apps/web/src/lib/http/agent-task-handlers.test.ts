import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

import type { TokenRepository } from "@/lib/services/agent-token-repository";
import { AgentRateLimitService } from "@/lib/services/agent-rate-limit-service";
import type { AgentAuthContext, AgentTokenScopes } from "@/lib/contracts/agent";

// Mock the token service
vi.mock("@/lib/services/agent-token-service", () => ({
  resolveAgentAuth: vi.fn(),
}));

// Mock the task service
vi.mock("@/lib/services/agent-task-service", () => ({
  getProjects: vi.fn(),
  getGoals: vi.fn(),
  getTasks: vi.fn(),
  createTasks: vi.fn(),
}));

import { resolveAgentAuth } from "@/lib/services/agent-token-service";
import { getProjects, getGoals, getTasks, createTasks } from "@/lib/services/agent-task-service";
import { createReadHandlers, createCreateHandlers } from "@/lib/http/agent-task-handlers";

const mockResolveAgentAuth = resolveAgentAuth as unknown as ReturnType<typeof vi.fn>;
const mockGetProjects = getProjects as unknown as ReturnType<typeof vi.fn>;
const mockGetGoals = getGoals as unknown as ReturnType<typeof vi.fn>;
const mockGetTasks = getTasks as unknown as ReturnType<typeof vi.fn>;
const mockCreateTasks = createTasks as unknown as ReturnType<typeof vi.fn>;

const mockRepo: TokenRepository = {
  findByPrefix: vi.fn(),
  insertToken: vi.fn(),
  updateLastUsedAt: vi.fn(),
  revokeToken: vi.fn(),
};

function makeAuthContext(overrides?: Partial<AgentAuthContext>): AgentAuthContext {
  return {
    tokenId: "token-1",
    ownerUserId: "00000000-0000-0000-0000-000000000001",
    scopes: {
      projects: { read: true },
      goals: { read: true },
      tasks: { read: true },
    },
    ...overrides,
  };
}

function makeRequest(url = "http://localhost:3000/api/agent/projects"): Request {
  return new Request(url, {
    headers: { authorization: "Bearer test_prefix_test_secret_here" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("agent-task-handlers", () => {
  describe("GET_PROJECTS", () => {
    it("returns 200 with projects list", async () => {
      mockResolveAgentAuth.mockResolvedValue({
        ok: true,
        context: makeAuthContext(),
      });

      mockGetProjects.mockResolvedValue({
        ok: true,
        data: [
          {
            id: "proj-1",
            name: "Test Project",
            slug: "test-project",
            description: null,
            status: "active",
            createdAt: "2024-01-01T00:00:00Z",
            updatedAt: "2024-01-02T00:00:00Z",
          },
        ],
      });

      const { GET_PROJECTS } = createReadHandlers(mockRepo);
      const response = await GET_PROJECTS(makeRequest());
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.projects).toHaveLength(1);
      expect(body.projects[0]!.name).toBe("Test Project");
      // Ensure sensitive fields are NOT in response
      expect(body.projects[0]!.owner_user_id).toBeUndefined();
      expect(body.projects[0]!.tokenId).toBeUndefined();
    });

    it("returns 401 when not authenticated", async () => {
      mockResolveAgentAuth.mockResolvedValue({
        ok: false,
        response: {
          ok: false,
          error: { code: "UNAUTHENTICATED", message: "Missing or invalid agent token." },
        },
        status: 401,
      });

      const { GET_PROJECTS } = createReadHandlers(mockRepo);
      const response = await GET_PROJECTS(makeRequest());

      expect(response.status).toBe(401);
    });

    it("returns 403 without projects:read scope", async () => {
      mockResolveAgentAuth.mockResolvedValue({
        ok: true,
        context: makeAuthContext({
          scopes: { projects: {}, goals: { read: true }, tasks: { read: true } },
        }),
      });

      const { GET_PROJECTS } = createReadHandlers(mockRepo);
      const response = await GET_PROJECTS(makeRequest());
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.error.code).toBe("FORBIDDEN");
    });

    it("returns 429 when rate limited", async () => {
      mockResolveAgentAuth.mockResolvedValue({
        ok: true,
        context: makeAuthContext(),
      });

      const rateLimiter = new AgentRateLimitService({
        windowSeconds: 60,
        maxRequests: 1,
      });
      // First request passes
      rateLimiter.check("token-1");

      const { GET_PROJECTS } = createReadHandlers(mockRepo, rateLimiter);
      const response = await GET_PROJECTS(makeRequest());

      expect(response.status).toBe(429);
      const body = await response.json();
      expect(body.error.code).toBe("RATE_LIMITED");

      rateLimiter.dispose();
    });

    it("returns 500 on internal service error", async () => {
      mockResolveAgentAuth.mockResolvedValue({
        ok: true,
        context: makeAuthContext(),
      });

      mockGetProjects.mockResolvedValue({
        ok: false,
        errorMessage: "Something went wrong",
      });

      const { GET_PROJECTS } = createReadHandlers(mockRepo);
      const response = await GET_PROJECTS(makeRequest());

      expect(response.status).toBe(500);
    });
  });

  describe("GET_GOALS", () => {
    it("returns 200 with goals list", async () => {
      mockResolveAgentAuth.mockResolvedValue({
        ok: true,
        context: makeAuthContext(),
      });

      mockGetGoals.mockResolvedValue({
        ok: true,
        data: [
          {
            id: "goal-1",
            projectId: "proj-1",
            title: "Test Goal",
            slug: "test-goal",
            description: null,
            nextStep: null,
            health: "good",
            status: "active",
            createdAt: "2024-01-01T00:00:00Z",
            updatedAt: "2024-01-02T00:00:00Z",
          },
        ],
      });

      const { GET_GOALS } = createReadHandlers(mockRepo);
      const response = await GET_GOALS(makeRequest("http://localhost:3000/api/agent/goals"));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.goals).toHaveLength(1);
      expect(body.goals[0]!.title).toBe("Test Goal");
      expect(body.goals[0]!.owner_user_id).toBeUndefined();
    });

    it("passes projectId query param", async () => {
      mockResolveAgentAuth.mockResolvedValue({
        ok: true,
        context: makeAuthContext(),
      });
      mockGetGoals.mockResolvedValue({ ok: true, data: [] });

      const { GET_GOALS } = createReadHandlers(mockRepo);
      await GET_GOALS(makeRequest("http://localhost:3000/api/agent/goals?projectId=proj-1"));

      expect(mockGetGoals).toHaveBeenCalledWith(
        expect.any(String),
        "proj-1",
      );
    });

    it("returns 403 without goals:read scope", async () => {
      mockResolveAgentAuth.mockResolvedValue({
        ok: true,
        context: makeAuthContext({
          scopes: { projects: { read: true }, goals: {}, tasks: { read: true } },
        }),
      });

      const { GET_GOALS } = createReadHandlers(mockRepo);
      const response = await GET_GOALS(makeRequest("http://localhost:3000/api/agent/goals"));

      expect(response.status).toBe(403);
    });
  });

  describe("GET_TASKS", () => {
    it("returns 200 with tasks list", async () => {
      mockResolveAgentAuth.mockResolvedValue({
        ok: true,
        context: makeAuthContext(),
      });

      mockGetTasks.mockResolvedValue({
        ok: true,
        data: [
          {
            id: "task-1",
            projectId: "proj-1",
            goalId: "goal-1",
            title: "Test Task",
            description: null,
            blockedReason: null,
            status: "todo",
            priority: "medium",
            estimateMinutes: null,
            focusRank: null,
            dueDate: null,
            plannedForDate: null,
            scheduledStartAt: null,
            scheduledEndAt: null,
            completedAt: null,
            archivedAt: null,
            createdAt: "2024-01-01T00:00:00Z",
            updatedAt: "2024-01-02T00:00:00Z",
            projectName: "Test Project",
            goalTitle: null,
          },
        ],
      });

      const { GET_TASKS } = createReadHandlers(mockRepo);
      const response = await GET_TASKS(makeRequest("http://localhost:3000/api/agent/tasks"));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.tasks).toHaveLength(1);
      expect(body.tasks[0]!.title).toBe("Test Task");
      // Sensitive fields must NOT be in response
      expect(body.tasks[0]!.owner_user_id).toBeUndefined();
      expect(body.tasks[0]!.calendar_event_id).toBeUndefined();
      expect(body.tasks[0]!.calendar_sync_status).toBeUndefined();
      expect(body.tasks[0]!.tokenHash).toBeUndefined();
    });

    it("validates limit parameter", async () => {
      mockResolveAgentAuth.mockResolvedValue({
        ok: true,
        context: makeAuthContext(),
      });

      const { GET_TASKS } = createReadHandlers(mockRepo);
      const response = await GET_TASKS(
        makeRequest("http://localhost:3000/api/agent/tasks?limit=999"),
      );

      expect(response.status).toBe(400);
    });

    it("returns 403 without tasks:read scope", async () => {
      mockResolveAgentAuth.mockResolvedValue({
        ok: true,
        context: makeAuthContext({
          scopes: { projects: { read: true }, goals: { read: true }, tasks: {} },
        }),
      });

      const { GET_TASKS } = createReadHandlers(mockRepo);
      const response = await GET_TASKS(makeRequest("http://localhost:3000/api/agent/tasks"));

      expect(response.status).toBe(403);
    });
  });

  describe("error handling", () => {
    it("returns 500 on unexpected error", async () => {
      mockResolveAgentAuth.mockRejectedValue(new Error("Unexpected error"));

      const { GET_PROJECTS } = createReadHandlers(mockRepo);
      const response = await GET_PROJECTS(makeRequest());

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe("INTERNAL_ERROR");
      // Must not leak internal details
      expect(body.error.message).not.toContain("Unexpected error");
    });
  });
});

describe("POST_TASKS", () => {
  function makeCreateRequest(body: unknown, url = "http://localhost:3000/api/agent/tasks"): Request {
    return new Request(url, {
      method: "POST",
      headers: { authorization: "Bearer test_prefix_test_secret_here", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function authContext(overrides?: Partial<ReturnType<typeof makeAuthContext>>) {
    return makeAuthContext({
      scopes: {
        tasks: { read: true, create: true },
        projects: { read: true },
        goals: { read: true },
      },
      ...overrides,
    });
  }

  beforeEach(() => {
    mockCreateTasks.mockResolvedValue({
      ok: true,
      created: [],
      existing: [],
      errors: [],
    });
  });

  it("returns 200 with created tasks", async () => {
    mockResolveAgentAuth.mockResolvedValue({ ok: true, context: authContext() });
    mockCreateTasks.mockResolvedValue({
      ok: true,
      created: [
        {
          id: "task-1",
          projectId: "proj-1",
          goalId: null,
          title: "New Task",
          description: null,
          blockedReason: null,
          status: "todo",
          priority: "medium",
          estimateMinutes: null,
          focusRank: null,
          dueDate: null,
          plannedForDate: null,
          scheduledStartAt: null,
          scheduledEndAt: null,
          completedAt: null,
          archivedAt: null,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-02T00:00:00Z",
          projectName: "Test Project",
          goalTitle: null,
        },
      ],
      existing: [],
      errors: [],
    });

    const { POST_TASKS } = createCreateHandlers(mockRepo);
    const response = await POST_TASKS(
      makeCreateRequest({ tasks: [{ title: "New Task", projectId: "proj-1" }] }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.created).toHaveLength(1);
    expect(body.created[0]!.title).toBe("New Task");
    expect(body.existing).toHaveLength(0);
    expect(body.errors).toHaveLength(0);
  });

  it("returns 200 with existing tasks from idempotency", async () => {
    mockResolveAgentAuth.mockResolvedValue({ ok: true, context: authContext() });
    mockCreateTasks.mockResolvedValue({
      ok: true,
      created: [],
      existing: [
        {
          id: "existing-1",
          projectId: "proj-1",
          goalId: null,
          title: "Existing Task",
          description: null,
          blockedReason: null,
          status: "todo",
          priority: "medium",
          estimateMinutes: null,
          focusRank: null,
          dueDate: null,
          plannedForDate: null,
          scheduledStartAt: null,
          scheduledEndAt: null,
          completedAt: null,
          archivedAt: null,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-02T00:00:00Z",
          projectName: "Test Project",
          goalTitle: null,
        },
      ],
      errors: [],
    });

    const { POST_TASKS } = createCreateHandlers(mockRepo);
    const response = await POST_TASKS(
      makeCreateRequest({
        tasks: [{ title: "Existing Task", projectId: "proj-1", source: "linear", sourceId: "L-123" }],
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.created).toHaveLength(0);
    expect(body.existing).toHaveLength(1);
    expect(body.existing[0]!.title).toBe("Existing Task");
  });

  it("returns 200 with partial errors", async () => {
    mockResolveAgentAuth.mockResolvedValue({ ok: true, context: authContext() });
    mockCreateTasks.mockResolvedValue({
      ok: true,
      created: [
        {
          id: "task-1",
          projectId: "proj-1",
          goalId: null,
          title: "Good Task",
          description: null,
          blockedReason: null,
          status: "todo",
          priority: "medium",
          estimateMinutes: null,
          focusRank: null,
          dueDate: null,
          plannedForDate: null,
          scheduledStartAt: null,
          scheduledEndAt: null,
          completedAt: null,
          archivedAt: null,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-02T00:00:00Z",
          projectName: "Test Project",
          goalTitle: null,
        },
      ],
      existing: [],
      errors: [{ index: 1, error: "Title is required." }],
    });

    const { POST_TASKS } = createCreateHandlers(mockRepo);
    const response = await POST_TASKS(
      makeCreateRequest({
        tasks: [
          { title: "Good Task", projectId: "proj-1" },
          { title: "", projectId: "proj-1" },
        ],
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.created).toHaveLength(1);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.index).toBe(1);
    expect(body.errors[0]!.error).toBe("Title is required.");
  });

  it("returns 401 when not authenticated", async () => {
    mockResolveAgentAuth.mockResolvedValue({
      ok: false,
      response: {
        ok: false,
        error: { code: "UNAUTHENTICATED", message: "Missing or invalid agent token." },
      },
      status: 401,
    });

    const { POST_TASKS } = createCreateHandlers(mockRepo);
    const response = await POST_TASKS(makeCreateRequest({ tasks: [] }));

    expect(response.status).toBe(401);
  });

  it("returns 403 without tasks:create scope", async () => {
    mockResolveAgentAuth.mockResolvedValue({
      ok: true,
      context: authContext({ scopes: { tasks: { read: true }, projects: { read: true }, goals: { read: true } } }),
    });

    const { POST_TASKS } = createCreateHandlers(mockRepo);
    const response = await POST_TASKS(makeCreateRequest({ tasks: [] }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("returns 400 when body is not valid JSON", async () => {
    mockResolveAgentAuth.mockResolvedValue({ ok: true, context: authContext() });

    const request = new Request("http://localhost:3000/api/agent/tasks", {
      method: "POST",
      headers: { authorization: "Bearer test_prefix_test_secret_here", "content-type": "application/json" },
      body: "not-json",
    });

    const { POST_TASKS } = createCreateHandlers(mockRepo);
    const response = await POST_TASKS(request);

    expect(response.status).toBe(400);
  });

  it("returns 400 when tasks array is missing", async () => {
    mockResolveAgentAuth.mockResolvedValue({ ok: true, context: authContext() });

    const { POST_TASKS } = createCreateHandlers(mockRepo);
    const response = await POST_TASKS(makeCreateRequest({}));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_REQUEST");
  });

  it("returns 400 when tasks array exceeds max limit", async () => {
    mockResolveAgentAuth.mockResolvedValue({
      ok: true,
      context: authContext({ scopes: { tasks: { create: true, bulkLimit: 5 }, projects: { read: true }, goals: { read: true } } }),
    });

    const { POST_TASKS } = createCreateHandlers(mockRepo);
    const response = await POST_TASKS(
      makeCreateRequest({
        tasks: Array.from({ length: 6 }, (_, i) => ({ title: `Task ${i}`, projectId: "proj-1" })),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_REQUEST");
  });

  it("returns 429 when rate limited", async () => {
    mockResolveAgentAuth.mockResolvedValue({ ok: true, context: authContext() });

    const rateLimiter = new AgentRateLimitService({ windowSeconds: 60, maxRequests: 1 });
    rateLimiter.check("token-1"); // consume the only slot

    const { POST_TASKS } = createCreateHandlers(mockRepo, rateLimiter);
    const response = await POST_TASKS(makeCreateRequest({ tasks: [] }));

    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.error.code).toBe("RATE_LIMITED");

    rateLimiter.dispose();
  });

  it("returns 500 on internal service error", async () => {
    mockResolveAgentAuth.mockResolvedValue({ ok: true, context: authContext() });
    mockCreateTasks.mockRejectedValue(new Error("Unexpected database error"));

    const { POST_TASKS } = createCreateHandlers(mockRepo);
    const response = await POST_TASKS(makeCreateRequest({ tasks: [{ title: "Fail", projectId: "proj-1" }] }));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });
});
