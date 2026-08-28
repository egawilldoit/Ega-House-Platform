import type { AuthInfo, ServerContext } from "@modelcontextprotocol/server";
import type { McpServer } from "@modelcontextprotocol/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod-v4";

import { MCP_PERMISSIONS, MCP_PERMISSION_PROFILES } from "@/lib/mcp/permissions";
import type {
  McpGoalFilters,
  McpTaskFilters,
} from "@/lib/mcp/read-repository";
import {
  GOAL_STATUS_VALUES,
  PROJECT_STATUS_VALUES,
  TASK_PRIORITY_VALUES,
  TASK_STATUS_VALUES,
} from "@/lib/task-domain";

export type McpProtocolContext = {
  requestId?: string | number;
};

export type McpReadToolHandlers = {
  getCapabilities: (
    authInfo: AuthInfo | undefined,
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  listProjects: (
    authInfo: AuthInfo | undefined,
    input: { limit?: number },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  listGoals: (
    authInfo: AuthInfo | undefined,
    input: McpGoalFilters,
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  listTasks: (
    authInfo: AuthInfo | undefined,
    input: McpTaskFilters,
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  getTodayPlan: (
    authInfo: AuthInfo | undefined,
    input: { date?: string },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  listTimerSessions: (
    authInfo: AuthInfo | undefined,
    input: { limit?: number; includeClosed?: boolean },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
};

export type McpWriteToolHandlers = {
  createProject: (
    authInfo: AuthInfo | undefined,
    input: { name: string; slug?: string; description?: string | null; operationId: string },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  updateProjectStatus: (
    authInfo: AuthInfo | undefined,
    input: { projectId: string; status: string; operationId: string },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  createGoal: (
    authInfo: AuthInfo | undefined,
    input: { title: string; projectId: string; description?: string | null; status?: string; slug?: string | null; operationId: string },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  createTask: (
    authInfo: AuthInfo | undefined,
    input: { title: string; projectId: string; goalId?: string | null; description?: string | null; status?: string; priority?: string; dueDate?: string | null; estimateMinutes?: number | null; operationId: string },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  updateTask: (
    authInfo: AuthInfo | undefined,
    input: { taskId: string; title?: string; status?: string; priority?: string; description?: string | null; operationId: string },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  planTaskForToday: (
    authInfo: AuthInfo | undefined,
    input: { taskId: string; date: string; operationId: string },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  startTimer: (
    authInfo: AuthInfo | undefined,
    input: { taskId: string; operationId: string },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  stopTimer: (
    authInfo: AuthInfo | undefined,
    input: { sessionId: string; operationId: string },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  clearCompletedToday: (
    authInfo: AuthInfo | undefined,
    input: { date: string; operationId: string },
    context?: ServerContext,
  ) => Promise<CallToolResult>;
};

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const DESTRUCTIVE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
} as const;

const limitSchema = z.number().int().min(1).max(100).default(25);
const uuidSchema = z.string().uuid();
const nullableStringSchema = z.string().nullable();
const nullableNumberSchema = z.number().finite().nullable();

const projectSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  slug: z.string(),
  description: nullableStringSchema,
  status: z.enum(PROJECT_STATUS_VALUES),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict();

const goalSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  title: z.string(),
  slug: nullableStringSchema,
  description: nullableStringSchema,
  nextStep: nullableStringSchema,
  health: nullableStringSchema,
  status: z.enum(GOAL_STATUS_VALUES),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict();

const taskSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  goalId: uuidSchema.nullable(),
  title: z.string(),
  description: nullableStringSchema,
  blockedReason: nullableStringSchema,
  status: z.enum(TASK_STATUS_VALUES),
  priority: z.enum(TASK_PRIORITY_VALUES),
  estimateMinutes: nullableNumberSchema,
  focusRank: nullableNumberSchema,
  dueDate: nullableStringSchema,
  plannedForDate: nullableStringSchema,
  scheduledStartAt: nullableStringSchema,
  scheduledEndAt: nullableStringSchema,
  completedAt: nullableStringSchema,
  archivedAt: nullableStringSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  projectName: nullableStringSchema,
  goalTitle: nullableStringSchema,
}).strict();

const capabilitiesInputSchema = z.object({}).strict();
const projectsInputSchema = z.object({
  limit: limitSchema,
}).strict();
const goalsInputSchema = z.object({
  projectId: uuidSchema.optional(),
  limit: limitSchema,
}).strict();
const tasksInputSchema = z.object({
  projectId: uuidSchema.optional(),
  goalId: uuidSchema.optional(),
  status: z.enum(TASK_STATUS_VALUES).optional(),
  priority: z.enum(TASK_PRIORITY_VALUES).optional(),
  includeArchived: z.boolean().default(false),
  limit: limitSchema,
}).strict();

const todayPlanInputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict();

const timerSessionsInputSchema = z.object({
  limit: limitSchema,
  includeClosed: z.boolean().default(false),
}).strict();

const capabilitiesOutputSchema = z.object({
  ok: z.literal(true),
  permissionProfile: z.enum(MCP_PERMISSION_PROFILES),
  permissionsVersion: z.number().int().positive(),
  permissions: z.array(z.enum(MCP_PERMISSIONS)),
  writesEnabled: z.boolean(),
}).strict();

const projectsOutputSchema = z.object({
  ok: z.literal(true),
  projects: z.array(projectSchema),
  count: z.number().int().nonnegative(),
}).strict();

const goalsOutputSchema = z.object({
  ok: z.literal(true),
  goals: z.array(goalSchema),
  count: z.number().int().nonnegative(),
}).strict();

const tasksOutputSchema = z.object({
  ok: z.literal(true),
  tasks: z.array(taskSchema),
  count: z.number().int().nonnegative(),
}).strict();

const todayPlanOutputSchema = z.object({
  ok: z.literal(true),
  today: z.string(),
  selectedCount: z.number().int().nonnegative(),
}).passthrough();

const timerSessionsOutputSchema = z.object({
  ok: z.literal(true),
  sessions: z.array(z.object({
    id: uuidSchema,
    taskId: uuidSchema,
    startedAt: z.string(),
    endedAt: z.string().nullable(),
  }).strict()),
  count: z.number().int().nonnegative(),
}).strict();

const createProjectInputSchema = z.object({
  name: z.string().min(1).max(256),
  slug: z.string().min(1).max(256).optional(),
  description: z.string().max(4000).nullable().optional(),
  operationId: z.string().uuid(),
}).strict();

const updateProjectStatusInputSchema = z.object({
  projectId: uuidSchema,
  status: z.enum(PROJECT_STATUS_VALUES),
  operationId: z.string().uuid(),
}).strict();

const createGoalInputSchema = z.object({
  title: z.string().min(1).max(256),
  projectId: uuidSchema,
  description: z.string().max(4000).nullable().optional(),
  status: z.enum(GOAL_STATUS_VALUES).optional(),
  slug: z.string().max(256).nullable().optional(),
  operationId: z.string().uuid(),
}).strict();

const createTaskInputSchema = z.object({
  title: z.string().min(1).max(256),
  projectId: uuidSchema,
  goalId: uuidSchema.nullable().optional(),
  description: z.string().max(4000).nullable().optional(),
  status: z.enum(TASK_STATUS_VALUES).optional(),
  priority: z.enum(TASK_PRIORITY_VALUES).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  estimateMinutes: z.number().int().min(1).max(10080).nullable().optional(),
  operationId: z.string().uuid(),
}).strict();

const updateTaskInputSchema = z.object({
  taskId: uuidSchema,
  title: z.string().min(1).max(256).optional(),
  status: z.enum(TASK_STATUS_VALUES).optional(),
  priority: z.enum(TASK_PRIORITY_VALUES).optional(),
  description: z.string().max(4000).nullable().optional(),
  operationId: z.string().uuid(),
}).strict();

const planTaskForTodayInputSchema = z.object({
  taskId: uuidSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  operationId: z.string().uuid(),
}).strict();

const startTimerInputSchema = z.object({
  taskId: uuidSchema,
  operationId: z.string().uuid(),
}).strict();

const stopTimerInputSchema = z.object({
  sessionId: uuidSchema,
  operationId: z.string().uuid(),
}).strict();

const clearCompletedTodayInputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  operationId: z.string().uuid(),
}).strict();

const genericSuccessOutputSchema = z.object({
  ok: z.literal(true),
}).passthrough();

function getProtocolContext(ctx: ServerContext): McpProtocolContext {
  const id =
    (ctx as unknown as { mcpReq?: { id?: string | number } }).mcpReq?.id
    ?? (ctx as unknown as { requestId?: string | number }).requestId;
  return { requestId: id };
}

function getAuthInfo(ctx: ServerContext): AuthInfo | undefined {
  return (ctx as unknown as { http?: { authInfo?: AuthInfo } }).http?.authInfo
    ?? (ctx as unknown as { authInfo?: AuthInfo }).authInfo;
}

export function registerMcpReadTools(
  server: McpServer,
  handlers: McpReadToolHandlers,
): void {
  server.registerTool(
    "ega_get_capabilities",
    {
      title: "Get EGA House capabilities",
      description:
        "Return the active EGA House permission profile and capabilities for this OAuth connection.",
      inputSchema: capabilitiesInputSchema,
      outputSchema: capabilitiesOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (_input, ctx) =>
      handlers.getCapabilities(getAuthInfo(ctx as unknown as ServerContext), getProtocolContext(ctx as unknown as ServerContext)),
  );

  server.registerTool(
    "ega_list_projects",
    {
      title: "List EGA House projects",
      description:
        "List projects owned by the authenticated EGA House user. Results are bounded and ordered newest first.",
      inputSchema: projectsInputSchema,
      outputSchema: projectsOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input, ctx) =>
      handlers.listProjects(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
  );

  server.registerTool(
    "ega_list_goals",
    {
      title: "List EGA House goals",
      description:
        "List goals owned by the authenticated EGA House user, optionally filtered by project.",
      inputSchema: goalsInputSchema,
      outputSchema: goalsOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input, ctx) =>
      handlers.listGoals(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
  );

  server.registerTool(
    "ega_list_tasks",
    {
      title: "List EGA House tasks",
      description:
        "List tasks owned by the authenticated EGA House user with optional project, goal, status, priority, and archive filters.",
      inputSchema: tasksInputSchema,
      outputSchema: tasksOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input, ctx) =>
      handlers.listTasks(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
  );

  server.registerTool(
    "ega_get_today_plan",
    {
      title: "Get Today plan",
      description: "Get Today projection (selected tasks, suggestions, timer snapshot) for date. Requires today.read.",
      inputSchema: todayPlanInputSchema,
      outputSchema: todayPlanOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input, ctx) =>
      handlers.getTodayPlan(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
  );

  server.registerTool(
    "ega_list_timer_sessions",
    {
      title: "List timer sessions",
      description: "List timer sessions (open and recent) for the authenticated user. Requires timer.read.",
      inputSchema: timerSessionsInputSchema,
      outputSchema: timerSessionsOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input, ctx) =>
      handlers.listTimerSessions(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
  );
}

export function registerMcpWriteTools(
  server: McpServer,
  handlers: McpWriteToolHandlers,
): void {
  server.registerTool(
    "ega_create_project",
    {
      title: "Create EGA House project",
      description: "Create a new project owned by the authenticated user. Requires workspace_manager.",
      inputSchema: createProjectInputSchema,
      outputSchema: genericSuccessOutputSchema,
      annotations: WRITE_ANNOTATIONS,
    },
    async (input, ctx) =>
      handlers.createProject(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
  );

  server.registerTool(
    "ega_update_project_status",
    {
      title: "Update project status",
      description: "Update status of an owned project. Requires workspace_manager.",
      inputSchema: updateProjectStatusInputSchema,
      outputSchema: genericSuccessOutputSchema,
      annotations: WRITE_ANNOTATIONS,
    },
    async (input, ctx) =>
      handlers.updateProjectStatus(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
  );

  server.registerTool(
    "ega_create_goal",
    {
      title: "Create EGA House goal",
      description: "Create a goal under an owned project. Requires workspace_manager.",
      inputSchema: createGoalInputSchema,
      outputSchema: genericSuccessOutputSchema,
      annotations: WRITE_ANNOTATIONS,
    },
    async (input, ctx) =>
      handlers.createGoal(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
  );

  server.registerTool(
    "ega_create_task",
    {
      title: "Create EGA House task",
      description: "Create a task under an owned project. Requires tasks.create and operationId for idempotency.",
      inputSchema: createTaskInputSchema,
      outputSchema: genericSuccessOutputSchema,
      annotations: WRITE_ANNOTATIONS,
    },
    async (input, ctx) =>
      handlers.createTask(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
  );

  server.registerTool(
    "ega_update_task",
    {
      title: "Update EGA House task",
      description: "Update an owned task. Requires tasks.update.",
      inputSchema: updateTaskInputSchema,
      outputSchema: genericSuccessOutputSchema,
      annotations: WRITE_ANNOTATIONS,
    },
    async (input, ctx) =>
      handlers.updateTask(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
  );

  server.registerTool(
    "ega_plan_task_for_today",
    {
      title: "Plan task for Today",
      description: "Set planned_for_date on an owned task (Today is a projection). Requires today.update.",
      inputSchema: planTaskForTodayInputSchema,
      outputSchema: genericSuccessOutputSchema,
      annotations: WRITE_ANNOTATIONS,
    },
    async (input, ctx) =>
      handlers.planTaskForToday(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
  );

  server.registerTool(
    "ega_start_timer",
    {
      title: "Start timer",
      description: "Start a timer session for an owned task. Enforces single open timer. Requires timer.create.",
      inputSchema: startTimerInputSchema,
      outputSchema: genericSuccessOutputSchema,
      annotations: WRITE_ANNOTATIONS,
    },
    async (input, ctx) =>
      handlers.startTimer(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
  );

  server.registerTool(
    "ega_stop_timer",
    {
      title: "Stop timer",
      description: "Stop an open timer session. Requires timer.update.",
      inputSchema: stopTimerInputSchema,
      outputSchema: genericSuccessOutputSchema,
      annotations: WRITE_ANNOTATIONS,
    },
    async (input, ctx) =>
      handlers.stopTimer(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
  );

  server.registerTool(
    "ega_clear_completed_today",
    {
      title: "Clear completed Today items",
      description: "Clear completed tasks planned for date. Requires today.update and human confirmation via MRTR.",
      inputSchema: clearCompletedTodayInputSchema,
      outputSchema: genericSuccessOutputSchema,
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async (input, ctx) =>
      handlers.clearCompletedToday(getAuthInfo(ctx as unknown as ServerContext), input, ctx as unknown as ServerContext),
  );
}

export function registerMcpTools(
  server: McpServer,
  readHandlers: McpReadToolHandlers,
  writeHandlers?: McpWriteToolHandlers,
): void {
  registerMcpReadTools(server, readHandlers);
  if (writeHandlers) registerMcpWriteTools(server, writeHandlers);
}
