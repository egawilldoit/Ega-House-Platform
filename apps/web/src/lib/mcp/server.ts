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
  GOAL_HEALTH_VALUES,
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
  getTask: (
    authInfo: AuthInfo | undefined,
    input: { taskId: string },
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
  archiveProject: (
    authInfo: AuthInfo | undefined,
    input: { projectId: string; operationId: string },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  unarchiveProject: (
    authInfo: AuthInfo | undefined,
    input: { projectId: string; operationId: string },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  createGoal: (
    authInfo: AuthInfo | undefined,
    input: { title: string; projectId: string; description?: string | null; status?: string; slug?: string | null; nextStep?: string | null; health?: string | null; operationId: string },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  updateGoalStatus: (
    authInfo: AuthInfo | undefined,
    input: { goalId: string; status: string; operationId: string },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  updateGoalHealth: (
    authInfo: AuthInfo | undefined,
    input: { goalId: string; health: string; operationId: string },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  updateGoalNextStep: (
    authInfo: AuthInfo | undefined,
    input: { goalId: string; nextStep: string; operationId: string },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  archiveGoal: (
    authInfo: AuthInfo | undefined,
    input: { goalId: string; operationId: string },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  unarchiveGoal: (
    authInfo: AuthInfo | undefined,
    input: { goalId: string; operationId: string },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  /** Legacy handler compatibility; ega_get_task is registered exclusively as a read tool. */
  getTask: (
    authInfo: AuthInfo | undefined,
    input: { taskId: string },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  createTask: (
    authInfo: AuthInfo | undefined,
    input: { title: string; projectId: string; goalId?: string | null; description?: string | null; blockedReason?: string | null; status?: string; priority?: string; dueDate?: string | null; estimateMinutes?: number | null; operationId: string },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  updateTask: (
    authInfo: AuthInfo | undefined,
    input: { taskId: string; title?: string; status?: string; priority?: string; description?: string | null; blockedReason?: string | null; dueDate?: string | null; estimateMinutes?: number | null; operationId: string },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  archiveTask: (
    authInfo: AuthInfo | undefined,
    input: { taskId: string; operationId: string },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  unarchiveTask: (
    authInfo: AuthInfo | undefined,
    input: { taskId: string; operationId: string },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  setTaskFocusRank: (
    authInfo: AuthInfo | undefined,
    input: { taskId: string; pinned: boolean; operationId: string },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  createTaskReminder: (
    authInfo: AuthInfo | undefined,
    input: { taskId: string; remindAt: string; operationId: string },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  cancelTaskReminder: (
    authInfo: AuthInfo | undefined,
    input: { taskId: string; reminderId: string; operationId: string },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  planTaskForToday: (
    authInfo: AuthInfo | undefined,
    input: { taskId: string; date: string; operationId: string },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  removeTaskFromToday: (
    authInfo: AuthInfo | undefined,
    input: { taskId: string; operationId: string },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  updateTodayTaskStatus: (
    authInfo: AuthInfo | undefined,
    input: { taskId: string; status: string; blockedReason?: string | null; operationId: string },
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

const archiveProjectInputSchema = z.object({
  projectId: uuidSchema,
  operationId: z.string().uuid(),
}).strict();

const createGoalInputSchema = z.object({
  title: z.string().min(1).max(256),
  projectId: uuidSchema,
  description: z.string().max(4000).nullable().optional(),
  status: z.enum(GOAL_STATUS_VALUES).optional(),
  slug: z.string().max(256).nullable().optional(),
  nextStep: z.string().max(2000).nullable().optional(),
  health: z.enum(GOAL_HEALTH_VALUES).nullable().optional(),
  operationId: z.string().uuid(),
}).strict();

const updateGoalStatusInputSchema = z.object({
  goalId: uuidSchema,
  status: z.enum(GOAL_STATUS_VALUES),
  operationId: z.string().uuid(),
}).strict();

const updateGoalHealthInputSchema = z.object({
  goalId: uuidSchema,
  health: z.enum(GOAL_HEALTH_VALUES),
  operationId: z.string().uuid(),
}).strict();

const updateGoalNextStepInputSchema = z.object({
  goalId: uuidSchema,
  nextStep: z.string().min(1).max(2000),
  operationId: z.string().uuid(),
}).strict();

const archiveGoalInputSchema = z.object({
  goalId: uuidSchema,
  operationId: z.string().uuid(),
}).strict();

const getTaskInputSchema = z.object({
  taskId: uuidSchema,
}).strict();

const createTaskInputSchema = z.object({
  title: z.string().min(1).max(256),
  projectId: uuidSchema,
  goalId: uuidSchema.nullable().optional(),
  description: z.string().max(4000).nullable().optional(),
  blockedReason: z.string().max(2000).nullable().optional(),
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
  blockedReason: z.string().max(2000).nullable().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  estimateMinutes: z.number().int().min(1).max(10080).nullable().optional(),
  operationId: z.string().uuid(),
}).strict();

const archiveTaskInputSchema = z.object({
  taskId: uuidSchema,
  operationId: z.string().uuid(),
}).strict();

const setTaskFocusRankInputSchema = z.object({
  taskId: uuidSchema,
  pinned: z.boolean(),
  operationId: z.string().uuid(),
}).strict();

const createTaskReminderInputSchema = z.object({
  taskId: uuidSchema,
  remindAt: z.string().min(10).max(64),
  operationId: z.string().uuid(),
}).strict();

const cancelTaskReminderInputSchema = z.object({
  taskId: uuidSchema,
  reminderId: uuidSchema,
  operationId: z.string().uuid(),
}).strict();

const planTaskForTodayInputSchema = z.object({
  taskId: uuidSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  operationId: z.string().uuid(),
}).strict();

const removeTaskFromTodayInputSchema = z.object({
  taskId: uuidSchema,
  operationId: z.string().uuid(),
}).strict();

const updateTodayTaskStatusInputSchema = z.object({
  taskId: uuidSchema,
  status: z.enum(TASK_STATUS_VALUES),
  blockedReason: z.string().max(2000).nullable().optional(),
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

const genericWriteOutputSchema = z
  .union([
    z.object({ ok: z.literal(true) }).passthrough(),
    z
      .object({
        ok: z.literal(false),
        error: z.object({ code: z.string(), message: z.string() }).passthrough(),
      })
      .passthrough(),
  ])
  .describe("MCP write result — ok:true on success, ok:false with error code on CONFLICT/IN_PROGRESS/PERMISSION_DENIED");

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

type ReadToolRegistration = {
  name: string;
  register: (server: McpServer, handlers: McpReadToolHandlers) => void;
};

const READ_TOOL_REGISTRATIONS: readonly ReadToolRegistration[] = [
  {
    name: "ega_get_capabilities",
    register: (server, handlers) =>
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
      ),
  },
  {
    name: "ega_list_projects",
    register: (server, handlers) =>
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
      ),
  },
  {
    name: "ega_list_goals",
    register: (server, handlers) =>
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
      ),
  },
  {
    name: "ega_list_tasks",
    register: (server, handlers) =>
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
      ),
  },
  {
    name: "ega_get_task",
    register: (server, handlers) =>
      server.registerTool(
        "ega_get_task",
        {
          title: "Get EGA House task",
          description: "Get a single owned task by id. Requires tasks.read.",
          inputSchema: getTaskInputSchema,
          outputSchema: genericWriteOutputSchema,
          annotations: READ_ONLY_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.getTask(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_get_today_plan",
    register: (server, handlers) =>
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
      ),
  },
  {
    name: "ega_list_timer_sessions",
    register: (server, handlers) =>
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
      ),
  },
];

export function registerMcpReadTools(
  server: McpServer,
  handlers: McpReadToolHandlers,
): void {
  for (const tool of READ_TOOL_REGISTRATIONS) {
    tool.register(server, handlers);
  }
}

type WriteToolRegistration = {
  name: string;
  register: (server: McpServer, handlers: McpWriteToolHandlers) => void;
};

const WRITE_TOOL_REGISTRATIONS: readonly WriteToolRegistration[] = [
  {
    name: "ega_create_project",
    register: (server, handlers) =>
      server.registerTool(
        "ega_create_project",
        {
          title: "Create EGA House project",
          description: "Create a new project owned by the authenticated user. Requires workspace_manager.",
          inputSchema: createProjectInputSchema,
          outputSchema: genericWriteOutputSchema,
          annotations: WRITE_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.createProject(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_update_project_status",
    register: (server, handlers) =>
      server.registerTool(
        "ega_update_project_status",
        {
          title: "Update project status",
          description: "Update status of an owned project. Requires workspace_manager.",
          inputSchema: updateProjectStatusInputSchema,
          outputSchema: genericWriteOutputSchema,
          annotations: WRITE_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.updateProjectStatus(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_archive_project",
    register: (server, handlers) =>
      server.registerTool(
        "ega_archive_project",
        {
          title: "Archive project",
          description: "Archive an owned project. Requires workspace_manager.",
          inputSchema: archiveProjectInputSchema,
          outputSchema: genericWriteOutputSchema,
          annotations: DESTRUCTIVE_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.archiveProject(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_unarchive_project",
    register: (server, handlers) =>
      server.registerTool(
        "ega_unarchive_project",
        {
          title: "Unarchive project",
          description: "Restore an archived project. Requires workspace_manager.",
          inputSchema: archiveProjectInputSchema,
          outputSchema: genericWriteOutputSchema,
          annotations: WRITE_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.unarchiveProject(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_create_goal",
    register: (server, handlers) =>
      server.registerTool(
        "ega_create_goal",
        {
          title: "Create EGA House goal",
          description: "Create a goal under an owned project. Requires workspace_manager.",
          inputSchema: createGoalInputSchema,
          outputSchema: genericWriteOutputSchema,
          annotations: WRITE_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.createGoal(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_update_goal_status",
    register: (server, handlers) =>
      server.registerTool(
        "ega_update_goal_status",
        {
          title: "Update goal status",
          description: "Update the status of an owned goal. Requires workspace_manager.",
          inputSchema: updateGoalStatusInputSchema,
          outputSchema: genericWriteOutputSchema,
          annotations: WRITE_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.updateGoalStatus(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_update_goal_health",
    register: (server, handlers) =>
      server.registerTool(
        "ega_update_goal_health",
        {
          title: "Update goal health",
          description: "Update the health of an owned goal. Requires workspace_manager.",
          inputSchema: updateGoalHealthInputSchema,
          outputSchema: genericWriteOutputSchema,
          annotations: WRITE_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.updateGoalHealth(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_update_goal_next_step",
    register: (server, handlers) =>
      server.registerTool(
        "ega_update_goal_next_step",
        {
          title: "Update goal next step",
          description: "Update the next step of an owned goal. Requires workspace_manager.",
          inputSchema: updateGoalNextStepInputSchema,
          outputSchema: genericWriteOutputSchema,
          annotations: WRITE_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.updateGoalNextStep(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_archive_goal",
    register: (server, handlers) =>
      server.registerTool(
        "ega_archive_goal",
        {
          title: "Archive goal",
          description: "Archive an owned goal. Requires workspace_manager.",
          inputSchema: archiveGoalInputSchema,
          outputSchema: genericWriteOutputSchema,
          annotations: DESTRUCTIVE_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.archiveGoal(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_unarchive_goal",
    register: (server, handlers) =>
      server.registerTool(
        "ega_unarchive_goal",
        {
          title: "Unarchive goal",
          description: "Restore an archived goal. Requires workspace_manager.",
          inputSchema: archiveGoalInputSchema,
          outputSchema: genericWriteOutputSchema,
          annotations: WRITE_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.unarchiveGoal(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_create_task",
    register: (server, handlers) =>
      server.registerTool(
        "ega_create_task",
        {
          title: "Create EGA House task",
          description: "Create a task under an owned project. Requires tasks.create and operationId for idempotency.",
          inputSchema: createTaskInputSchema,
          outputSchema: genericWriteOutputSchema,
          annotations: WRITE_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.createTask(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_update_task",
    register: (server, handlers) =>
      server.registerTool(
        "ega_update_task",
        {
          title: "Update EGA House task",
          description: "Update an owned task. Requires tasks.update.",
          inputSchema: updateTaskInputSchema,
          outputSchema: genericWriteOutputSchema,
          annotations: WRITE_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.updateTask(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_archive_task",
    register: (server, handlers) =>
      server.registerTool(
        "ega_archive_task",
        {
          title: "Archive task",
          description: "Archive an owned task. Requires tasks.update.",
          inputSchema: archiveTaskInputSchema,
          outputSchema: genericWriteOutputSchema,
          annotations: DESTRUCTIVE_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.archiveTask(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_unarchive_task",
    register: (server, handlers) =>
      server.registerTool(
        "ega_unarchive_task",
        {
          title: "Unarchive task",
          description: "Restore an archived task. Requires tasks.update.",
          inputSchema: archiveTaskInputSchema,
          outputSchema: genericWriteOutputSchema,
          annotations: WRITE_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.unarchiveTask(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_set_task_focus_rank",
    register: (server, handlers) =>
      server.registerTool(
        "ega_set_task_focus_rank",
        {
          title: "Set task focus",
          description: "Pin or unpin an owned task in the focus queue. Requires tasks.update.",
          inputSchema: setTaskFocusRankInputSchema,
          outputSchema: genericWriteOutputSchema,
          annotations: WRITE_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.setTaskFocusRank(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_create_task_reminder",
    register: (server, handlers) =>
      server.registerTool(
        "ega_create_task_reminder",
        {
          title: "Create task reminder",
          description: "Create a reminder for an owned task. Requires tasks.update.",
          inputSchema: createTaskReminderInputSchema,
          outputSchema: genericWriteOutputSchema,
          annotations: WRITE_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.createTaskReminder(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_cancel_task_reminder",
    register: (server, handlers) =>
      server.registerTool(
        "ega_cancel_task_reminder",
        {
          title: "Cancel task reminder",
          description: "Cancel a reminder on an owned task. Requires tasks.update.",
          inputSchema: cancelTaskReminderInputSchema,
          outputSchema: genericWriteOutputSchema,
          annotations: DESTRUCTIVE_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.cancelTaskReminder(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_plan_task_for_today",
    register: (server, handlers) =>
      server.registerTool(
        "ega_plan_task_for_today",
        {
          title: "Plan task for Today",
          description: "Set planned_for_date on an owned task (Today is a projection). Requires today.update.",
          inputSchema: planTaskForTodayInputSchema,
          outputSchema: genericWriteOutputSchema,
          annotations: WRITE_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.planTaskForToday(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_remove_task_from_today",
    register: (server, handlers) =>
      server.registerTool(
        "ega_remove_task_from_today",
        {
          title: "Remove task from Today",
          description: "Clear planned_for_date on an owned task (task is kept). Requires today.update.",
          inputSchema: removeTaskFromTodayInputSchema,
          outputSchema: genericWriteOutputSchema,
          annotations: WRITE_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.removeTaskFromToday(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_update_today_task_status",
    register: (server, handlers) =>
      server.registerTool(
        "ega_update_today_task_status",
        {
          title: "Update Today task status",
          description: "Update the status of an owned task via the Today projection. Requires today.update.",
          inputSchema: updateTodayTaskStatusInputSchema,
          outputSchema: genericWriteOutputSchema,
          annotations: WRITE_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.updateTodayTaskStatus(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_start_timer",
    register: (server, handlers) =>
      server.registerTool(
        "ega_start_timer",
        {
          title: "Start timer",
          description: "Start a timer session for an owned task. Enforces single open timer. Requires timer.create.",
          inputSchema: startTimerInputSchema,
          outputSchema: genericWriteOutputSchema,
          annotations: WRITE_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.startTimer(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_stop_timer",
    register: (server, handlers) =>
      server.registerTool(
        "ega_stop_timer",
        {
          title: "Stop timer",
          description: "Stop an open timer session. Requires timer.update.",
          inputSchema: stopTimerInputSchema,
          outputSchema: genericWriteOutputSchema,
          annotations: WRITE_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.stopTimer(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_clear_completed_today",
    register: (server, handlers) =>
      server.registerTool(
        "ega_clear_completed_today",
        {
          title: "Clear completed Today items",
          description: "Clear completed tasks planned for date. Requires today.update and human confirmation via MRTR.",
          inputSchema: clearCompletedTodayInputSchema,
          outputSchema: genericWriteOutputSchema,
          annotations: DESTRUCTIVE_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.clearCompletedToday(getAuthInfo(ctx as unknown as ServerContext), input, ctx as unknown as ServerContext),
      ),
  },
];

export function registerMcpWriteTools(
  server: McpServer,
  handlers: McpWriteToolHandlers,
): void {
  for (const tool of WRITE_TOOL_REGISTRATIONS) {
    tool.register(server, handlers);
  }
}

/**
 * Permission-aware per-request registration: only tools whose names appear in
 * `allowedNames` (computed from the verified principal + kill switch) are
 * advertised on this connection. Reads and writes share the same registry.
 */
export function registerMcpToolsForPrincipal(
  server: McpServer,
  readHandlers: McpReadToolHandlers,
  writeHandlers: McpWriteToolHandlers | undefined,
  allowedNames: ReadonlySet<string>,
): void {
  for (const tool of READ_TOOL_REGISTRATIONS) {
    if (allowedNames.has(tool.name)) tool.register(server, readHandlers);
  }
  if (!writeHandlers) return;
  for (const tool of WRITE_TOOL_REGISTRATIONS) {
    if (allowedNames.has(tool.name)) tool.register(server, writeHandlers);
  }
}

export function registerMcpTools(
  server: McpServer,
  readHandlers: McpReadToolHandlers,
  writeHandlers?: McpWriteToolHandlers,
): void {
  registerMcpReadTools(server, readHandlers);
  if (writeHandlers) registerMcpWriteTools(server, writeHandlers);
}
