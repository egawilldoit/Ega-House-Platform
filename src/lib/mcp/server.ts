import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { MCP_PERMISSIONS, MCP_PERMISSION_PROFILES } from "@/lib/mcp/permissions";
import type { createMcpReadToolHandlers } from "@/lib/mcp/read-tool-handlers";

type McpReadToolHandlers = ReturnType<typeof createMcpReadToolHandlers>;

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const limitSchema = z.number().int().min(1).max(100).default(25);
const uuidSchema = z.string().uuid();
const optionalFilterSchema = z.string().trim().min(1).max(64).optional();

const nullableStringSchema = z.string().nullable();
const nullableNumberSchema = z.number().finite().nullable();

const projectSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  slug: z.string(),
  description: nullableStringSchema,
  status: z.string(),
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
  status: z.string(),
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
  status: z.string(),
  priority: z.string(),
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
  status: optionalFilterSchema,
  priority: optionalFilterSchema,
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
    async (_input, extra) => handlers.getCapabilities(extra.authInfo),
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
    async (input, extra) => handlers.listProjects(extra.authInfo, input),
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
    async (input, extra) => handlers.listGoals(extra.authInfo, input),
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
    async (input, extra) => handlers.listTasks(extra.authInfo, input),
  );
}
