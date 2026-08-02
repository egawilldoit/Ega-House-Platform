import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

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
};

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
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

function getProtocolContext(extra: { requestId?: string | number }): McpProtocolContext {
  return { requestId: extra.requestId };
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
    async (_input, extra) =>
      handlers.getCapabilities(extra.authInfo, getProtocolContext(extra)),
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
    async (input, extra) =>
      handlers.listProjects(extra.authInfo, input, getProtocolContext(extra)),
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
    async (input, extra) =>
      handlers.listGoals(extra.authInfo, input, getProtocolContext(extra)),
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
    async (input, extra) =>
      handlers.listTasks(extra.authInfo, input, getProtocolContext(extra)),
  );
}
