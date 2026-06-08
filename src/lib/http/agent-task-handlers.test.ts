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
}));

import { resolveAgentAuth } from "@/lib/services/agent-token-service";
import { getProjects, getGoals, getTasks } from "@/lib/services/agent-task-service";
import { createReadHandlers } from "@/lib/http/agent-task-handlers";

const mockResolveAgentAuth = resolveAgentAuth as unknown as ReturnType<typeof vi.fn>;
const mockGetProjects = getProjects as unknown as ReturnType<typeof vi.fn>;
const mockGetGoals = getGoals as unknown as ReturnType<typeof vi.fn>;
const mockGetTasks = getTasks as unknown as ReturnType<typeof vi.fn>;

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
