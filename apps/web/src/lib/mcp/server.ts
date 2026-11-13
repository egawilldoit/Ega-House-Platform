import type { AuthInfo, ServerContext } from "@modelcontextprotocol/server";
import type { McpServer } from "@modelcontextprotocol/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod-v4";

import { MCP_PERMISSIONS, MCP_PERMISSION_PROFILES } from "@/lib/mcp/permissions";
import { EXPENSE_CATEGORY_VALUES } from "@ega/domain/expenses";
import {
  OBLIGATION_CADENCES,
  OBLIGATION_KINDS,
  OBLIGATION_STATES,
} from "@ega/domain/obligations";
import { MONEY_PURPOSES } from "@ega/domain/money";
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
  TASK_TITLE_MAX,
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
  personalOpsSummary: (
    authInfo: AuthInfo | undefined,
    input: { date?: string; timezone?: string },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  personalOpsExpensesList: (
    authInfo: AuthInfo | undefined,
    input: { from?: string; to?: string; timezone?: string; limit?: number; offset?: number },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  personalOpsCheckinGet: (
    authInfo: AuthInfo | undefined,
    input: { localDate: string; timezone: string },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  /** MONEY-02 canonical Money reads. */
  getMoneyExpense: (
    authInfo: AuthInfo | undefined,
    input: { expenseId: string },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  listMoneyLedger: (
    authInfo: AuthInfo | undefined,
    input: { from?: string; to?: string; timezone?: string; limit?: number; offset?: number },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  /** MONEY-03 period/active-date state. */
  moneyState: (
    authInfo: AuthInfo | undefined,
    input: { periodId?: string; date?: string; mode?: "today" | "active_day" },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  /** MONEY-10 rollover preview for one finished source period. */
  moneyRolloverPreview: (
    authInfo: AuthInfo | undefined,
    input: { periodId: string },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  /** MONEY-04 movement reads (distinct from the expense ledger reads). */
  moneyMovementList: (
    authInfo: AuthInfo | undefined,
    input: {
      from?: string;
      to?: string;
      cutoff?: string;
      timezone?: string;
      kind?: string;
      limit?: number;
    },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  moneyObligationsList: (
    authInfo: AuthInfo | undefined,
    input: {
      kind?: string;
      state?: string;
      dueFrom?: string;
      dueTo?: string;
      limit?: number;
    },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  moneyMovementGet: (
    authInfo: AuthInfo | undefined,
    input: { movementId: string },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  /** MONEY-05 budget plan and counted coffee reads. */
  moneyBudgetGet: (
    authInfo: AuthInfo | undefined,
    input: { periodStartDate: string; periodEndDate: string },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  moneyCoffeeWindow: (
    authInfo: AuthInfo | undefined,
    input: {
      localDate: string;
      timezone: string;
      periodStartDate: string;
      periodEndDate: string;
    },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  moneyCoffeeVisitList: (
    authInfo: AuthInfo | undefined,
    input: { from: string; to: string; limit?: number; offset?: number },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  moneyObligationGet: (
    authInfo: AuthInfo | undefined,
    input: { obligationId: string },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  moneyObligationTemplatesList: (
    authInfo: AuthInfo | undefined,
    input: { kind?: string; includeArchived?: boolean },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  moneyObligationsSummary: (
    authInfo: AuthInfo | undefined,
    input: { cutoff: string },
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
  /** Read-handler compatibility; ega_get_task is registered exclusively as a read tool. */
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
  createPersonalOpsExpense: (
    authInfo: AuthInfo | undefined,
    input: {
      occurredAt: string;
      amountMinor: number;
      category: string;
      needVsWant: "need" | "want";
      note?: string | null;
      merchant?: string | null;
      paymentMethod?: string | null;
      idempotencyKey: string;
      operationId: string;
    },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  savePersonalOpsCheckin: (
    authInfo: AuthInfo | undefined,
    input: { localDate: string; timezone: string; patch: Record<string, unknown>; operationId: string },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  /** MONEY-02 canonical Money writes. */
  createMoneyExpense: (
    authInfo: AuthInfo | undefined,
    input: {
      occurredAt: string;
      amountMinor: number;
      category: string;
      needVsWant: "need" | "want";
      note?: string | null;
      merchant?: string | null;
      paymentMethod?: string | null;
      idempotencyKey: string;
      operationId: string;
    },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  updateMoneyExpense: (
    authInfo: AuthInfo | undefined,
    input: {
      expenseId: string;
      expectedVersion: number;
      occurredAt?: string;
      amountMinor?: number;
      category?: string;
      needVsWant?: "need" | "want";
      note?: string | null;
      merchant?: string | null;
      paymentMethod?: string | null;
      operationId: string;
    },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  deleteMoneyExpense: (
    authInfo: AuthInfo | undefined,
    input: { expenseId: string; expectedVersion: number; operationId: string },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  updateMoneySettings: (
    authInfo: AuthInfo | undefined,
    input: {
      operationId: string;
      periodId?: string;
      version?: number;
      startDate?: string;
      endDate?: string;
      timezone?: string;
      activeDate?: string;
      opening?: {
        amountMinor: number;
        source: "user_entered" | "carry_forward" | "verified_source";
        cutoffDate?: string | null;
        evidence?: string | null;
        note?: string | null;
      } | null;
      settings?: Record<string, unknown>;
    },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  rebaseMoneyDayStartBaseline: (authInfo: AuthInfo | undefined, input: { periodId: string; operationId: string }, context?: McpProtocolContext) => Promise<CallToolResult>;
  /** MONEY-10 explicit rollover. The source must already be ended by a close. */
  rolloverMoneyPeriod: (
    authInfo: AuthInfo | undefined,
    input: {
      operationId: string;
      periodId: string;
      expectedVersion: number;
      startDate: string;
      endDate: string;
      opening:
        | { mode: "carry_forward" }
        | {
            mode: "verified_source";
            amountMinor: number;
            cutoffDate: string;
            evidence: string;
            note?: string | null;
          };
      unpaidItems?:
        | {
            treatment: "keep_pending" | "carry_forward" | "cancel";
            reason?: string | null;
          }
        | null;
      settingsOverrides?: Record<string, unknown> | null;
      allowUncoveredDays?: boolean;
      acceptClosingDifferenceNote?: string | null;
    },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  /** MONEY-04 movement writes on the one ledger. */
  createMoneyMovement: (
    authInfo: AuthInfo | undefined,
    input: {
      kind: string;
      direction?: "in" | "out";
      amountMinor: number;
      category?: string | null;
      note?: string | null;
      merchant?: string | null;
      needVsWant?: "need" | "want" | null;
      paymentMethod?: string | null;
      purpose?: "fixed" | "flexible" | "emergency" | null;
      countsInDaily?: boolean;
      bookingDate?: string;
      occurredAt?: string | null;
      idempotencyKey: string;
      operationId: string;
    },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  updateMoneyMovement: (
    authInfo: AuthInfo | undefined,
    input: {
      movementId: string;
      version: number;
      bookingDate?: string;
      occurredAt?: string | null;
      amountMinor?: number;
      category?: string;
      note?: string | null;
      merchant?: string | null;
      needVsWant?: "need" | "want";
      paymentMethod?: string | null;
      purpose?: "fixed" | "flexible" | "emergency" | null;
      countsInDaily?: boolean;
      operationId: string;
    },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  /** MONEY-05 budget, classification and counted coffee writes. */
  setMoneyAllocation: (
    authInfo: AuthInfo | undefined,
    input: {
      periodStartDate: string;
      periodEndDate: string;
      version: number;
      allocations?: Record<string, number | null>;
      savingsTargetMinor?: number | null;
      emergencyTargetMinor?: number | null;
      coffeeWeeklySpendLimitMinor?: number | null;
      coffeeWeeklyVisitLimit?: number | null;
      operationId: string;
    },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  classifyMoneyExpense: (
    authInfo: AuthInfo | undefined,
    input: {
      expenseId: string;
      version: number;
      category: string;
      note?: string | null;
      needVsWant?: "need" | "want";
      operationId: string;
    },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  recordCoffeeVisit: (
    authInfo: AuthInfo | undefined,
    input: {
      visitKey: string;
      localDate: string;
      timezone: string;
      expenseIds: string[];
      note?: string | null;
      operationId: string;
    },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  deleteCoffeeVisit: (
    authInfo: AuthInfo | undefined,
    input: { visitId: string; version: number; operationId: string },
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
  createMoneyObligation: (
    authInfo: AuthInfo | undefined,
    input: {
      kind: string;
      description: string;
      amountMinor: number;
      dueDate: string;
      periodStart?: string;
      periodEnd?: string;
      templateId?: string | null;
      needVsWant?: "need" | "want" | null;
      purpose?: string | null;
      countsInDaily?: boolean | null;
      category?: string | null;
      stateEffectiveDate: string;
      idempotencyKey: string;
      operationId: string;
    },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  updateMoneyObligation: (
    authInfo: AuthInfo | undefined,
    input: {
      obligationId: string;
      version: number;
      description?: string;
      amountMinor?: number;
      periodStart?: string;
      periodEnd?: string;
      dueDate?: string;
      needVsWant?: "need" | "want" | null;
      purpose?: string;
      countsInDaily?: boolean;
      category?: string | null;
      operationId: string;
    },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  transitionMoneyObligation: (
    authInfo: AuthInfo | undefined,
    input: {
      obligationId: string;
      version: number;
      to: string;
      effectiveDate: string;
      reason?: string | null;
      operationId: string;
    },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  createMoneyObligationTemplate: (
    authInfo: AuthInfo | undefined,
    input: {
      kind: string;
      description: string;
      amountMinor: number;
      cadence: string;
      dueDayOfMonth?: number | null;
      dueWeekday?: number | null;
      startDate: string;
      endDate?: string | null;
      needVsWant?: "need" | "want" | null;
      purpose?: string | null;
      countsInDaily?: boolean | null;
      category?: string | null;
      idempotencyKey: string;
      operationId: string;
    },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  updateMoneyObligationTemplate: (
    authInfo: AuthInfo | undefined,
    input: {
      templateId: string;
      version: number;
      description?: string;
      amountMinor?: number;
      cadence?: string;
      dueDayOfMonth?: number | null;
      dueWeekday?: number | null;
      startDate?: string;
      endDate?: string | null;
      needVsWant?: "need" | "want" | null;
      purpose?: string | null;
      countsInDaily?: boolean | null;
      category?: string | null;
      lifecycle?: "active" | "archived";
      operationId: string;
    },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  generateMoneyObligations: (
    authInfo: AuthInfo | undefined,
    input: { templateId: string; throughDate: string; operationId: string },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  payMoneyObligation: (
    authInfo: AuthInfo | undefined,
    input: {
      obligationId: string;
      version: number;
      bookingDate: string;
      needVsWant?: "need" | "want" | null;
      countsInDaily?: boolean | null;
      paymentMethod?: string | null;
      operationId: string;
    },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  correctMoneyObligationPayment: (
    authInfo: AuthInfo | undefined,
    input: {
      obligationId: string;
      version: number;
      amountMinor: number;
      bookingDate: string;
      countsInDaily?: boolean | null;
      operationId: string;
    },
    context?: McpProtocolContext,
  ) => Promise<CallToolResult>;
  undoMoneyObligationPayment: (
    authInfo: AuthInfo | undefined,
    input: { obligationId: string; version: number; operationId: string },
    context?: McpProtocolContext,
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

const personalOpsSummaryInputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  timezone: z.string().optional(),
}).strict();

const offsetSchema = z.number().int().min(0).max(1_000_000).default(0);

const personalOpsExpensesInputSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  timezone: z.string().optional(),
  limit: limitSchema,
  offset: offsetSchema,
}).strict();

const moneyLedgerListInputSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  timezone: z.string().optional(),
  limit: limitSchema,
  offset: offsetSchema,
}).strict();

const moneyExpenseIdInputSchema = z.object({
  expenseId: uuidSchema,
}).strict();

const moneyUpdateExpenseInputSchema = z.object({
  expenseId: uuidSchema,
  expectedVersion: z.number().int().positive(),
  occurredAt: z.string().optional(),
  amountMinor: z.number().int().positive().optional(),
  category: z.string().optional(),
  needVsWant: z.enum(["need", "want"]).optional(),
  note: nullableStringSchema.optional(),
  merchant: nullableStringSchema.optional(),
  paymentMethod: nullableStringSchema.optional(),
  operationId: z.string().uuid(),
}).strict();

const moneyDeleteExpenseInputSchema = z.object({
  expenseId: uuidSchema,
  expectedVersion: z.number().int().positive(),
  operationId: z.string().uuid(),
}).strict();

const personalOpsCheckinInputSchema = z.object({
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone: z.string(),
}).strict();

const moneyStateInputSchema = z.object({
  periodId: uuidSchema.optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  mode: z.enum(["today", "active_day"]).optional(),
}).strict();

const moneyOpeningInputSchema = z.object({
  amountMinor: z.number().int().min(0),
  source: z.enum(["user_entered", "carry_forward", "verified_source"]),
  cutoffDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  evidence: z.string().max(500).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
}).strict();

const moneyUpdateSettingsInputSchema = z.object({
  operationId: z.string().uuid(),
  periodId: uuidSchema.optional(),
  version: z.number().int().positive().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  timezone: z.string().min(1).max(128).optional(),
  activeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  opening: moneyOpeningInputSchema.nullable().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
}).strict();

const moneyRebaseDayStartInputSchema = z.object({ periodId: uuidSchema, operationId: z.string().uuid() }).strict();

const moneyRolloverDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const moneyRolloverPreviewInputSchema = z.object({ periodId: uuidSchema }).strict();
const moneyRolloverOpeningSchema = z.union([
  z.object({ mode: z.literal("carry_forward") }).strict(),
  z
    .object({
      mode: z.literal("verified_source"),
      amountMinor: z.number().int().min(0),
      cutoffDate: moneyRolloverDateSchema,
      evidence: z.string().min(1).max(500),
      note: z.string().max(500).nullable().optional(),
    })
    .strict(),
]);
const moneyRolloverInputSchema = z
  .object({
    operationId: z.string().uuid(),
    periodId: uuidSchema,
    expectedVersion: z.number().int().positive(),
    startDate: moneyRolloverDateSchema,
    endDate: moneyRolloverDateSchema,
    opening: moneyRolloverOpeningSchema,
    unpaidItems: z
      .object({
        treatment: z.enum(["keep_pending", "carry_forward", "cancel"]),
        reason: z.string().max(200).nullable().optional(),
      })
      .strict()
      .nullable()
      .optional(),
    settingsOverrides: z.record(z.string(), z.unknown()).nullable().optional(),
    allowUncoveredDays: z.boolean().optional(),
    acceptClosingDifferenceNote: z.string().min(3).max(500).nullable().optional(),
  })
  .strict();

const moneyStateOutputSchema = z.object({
  ok: z.literal(true),
}).passthrough();

const obligationDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const obligationKindSchema = z.enum(OBLIGATION_KINDS);
const obligationStateSchema = z.enum(OBLIGATION_STATES);
const obligationPurposeSchema = z.enum(MONEY_PURPOSES);
const obligationCategorySchema = z.enum(EXPENSE_CATEGORY_VALUES);
const obligationCadenceSchema = z.enum(OBLIGATION_CADENCES);
const obligationNeedVsWantSchema = z.enum(["need", "want"]);

const moneyObligationsInputSchema = z.object({
  kind: obligationKindSchema.optional(),
  state: obligationStateSchema.optional(),
  dueFrom: obligationDateSchema.optional(),
  dueTo: obligationDateSchema.optional(),
  limit: limitSchema,
}).strict();

const moneyObligationGetInputSchema = z.object({
  obligationId: uuidSchema,
}).strict();

const moneyObligationTemplatesInputSchema = z.object({
  kind: obligationKindSchema.optional(),
  includeArchived: z.boolean().default(false),
}).strict();

const moneyObligationSummaryInputSchema = z.object({
  cutoff: obligationDateSchema,
}).strict();

const personalOpsSummaryOutputSchema = z.object({
  ok: z.literal(true),
}).passthrough();

const personalOpsListOutputSchema = z.object({
  ok: z.literal(true),
}).passthrough();

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
  title: z.string().min(1).max(TASK_TITLE_MAX),
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
  title: z.string().min(1).max(TASK_TITLE_MAX).optional(),
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

const personalOpsExpenseInputSchema = z.object({
  occurredAt: z.string(),
  amountMinor: z.number().int().positive(),
  category: z.string(),
  needVsWant: z.enum(["need", "want"]),
  note: nullableStringSchema,
  merchant: nullableStringSchema,
  paymentMethod: nullableStringSchema,
  idempotencyKey: z.string().min(1),
  operationId: z.string().uuid(),
}).strict();

const personalOpsCheckinSaveInputSchema = z.object({
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone: z.string(),
  patch: z.record(z.string(), z.unknown()),
  operationId: z.string().uuid(),
}).strict();

const moneyCreateExpenseInputSchema = z.object({
  occurredAt: z.string(),
  amountMinor: z.number().int().positive(),
  category: z.string(),
  needVsWant: z.enum(["need", "want"]),
  note: nullableStringSchema.optional(),
  merchant: nullableStringSchema.optional(),
  paymentMethod: nullableStringSchema.optional(),
  idempotencyKey: z.string().min(1),
  operationId: z.string().uuid(),
}).strict();

// MONEY-04 movement schemas. `opening` is owned by MONEY-03 period
// initialization and is intentionally absent from the create enum.
const moneyMovementDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const moneyMovementListInputSchema = z.object({
  from: moneyMovementDateSchema.optional(),
  to: moneyMovementDateSchema.optional(),
  cutoff: moneyMovementDateSchema.optional(),
  timezone: z.string().optional(),
  kind: z.enum(["expense", "income", "opening", "savings_transfer", "reconciliation_adjustment"]).optional(),
  limit: limitSchema,
}).strict();

const moneyMovementGetInputSchema = z.object({
  movementId: uuidSchema,
}).strict();

const moneyCreateMovementInputSchema = z.object({
  kind: z.enum(["expense", "income", "savings_transfer", "reconciliation_adjustment"]),
  direction: z.enum(["in", "out"]).optional(),
  amountMinor: z.number().int().positive(),
  category: nullableStringSchema.optional(),
  note: nullableStringSchema.optional(),
  merchant: nullableStringSchema.optional(),
  needVsWant: z.enum(["need", "want"]).nullable().optional(),
  paymentMethod: nullableStringSchema.optional(),
  purpose: z.enum(["fixed", "flexible", "emergency"]).nullable().optional(),
  countsInDaily: z.boolean().optional(),
  bookingDate: moneyMovementDateSchema.optional(),
  occurredAt: z.string().nullable().optional(),
  idempotencyKey: z.string().min(1),
  operationId: z.string().uuid(),
}).strict();

const moneyUpdateMovementInputSchema = z.object({
  movementId: uuidSchema,
  version: z.number().int().positive(),
  bookingDate: moneyMovementDateSchema.optional(),
  occurredAt: z.string().nullable().optional(),
  amountMinor: z.number().int().positive().optional(),
  category: z.string().optional(),
  note: nullableStringSchema.optional(),
  merchant: nullableStringSchema.optional(),
  needVsWant: z.enum(["need", "want"]).optional(),
  paymentMethod: nullableStringSchema.optional(),
  purpose: z.enum(["fixed", "flexible", "emergency"]).nullable().optional(),
  countsInDaily: z.boolean().optional(),
  operationId: z.string().uuid(),
}).strict();

// MONEY-05 budget, classification and counted-visit schemas. Amounts stay
// non-negative integer MAD centimes; category text is validated by the domain
// so appended categories do not need a parallel MCP enum.
const moneyBudgetPeriodSchema = z.object({
  periodStartDate: moneyMovementDateSchema,
  periodEndDate: moneyMovementDateSchema,
}).strict();

const moneyBudgetGetInputSchema = moneyBudgetPeriodSchema;

const moneySetAllocationInputSchema = z.object({
  periodStartDate: moneyMovementDateSchema,
  periodEndDate: moneyMovementDateSchema,
  version: z.number().int().min(0),
  allocations: z.record(z.string(), z.number().int().min(0).max(2147483647).nullable()).optional(),
  savingsTargetMinor: z.number().int().min(0).max(2147483647).nullable().optional(),
  emergencyTargetMinor: z.number().int().min(0).max(2147483647).nullable().optional(),
  coffeeWeeklySpendLimitMinor: z.number().int().min(0).max(2147483647).nullable().optional(),
  coffeeWeeklyVisitLimit: z.number().int().min(0).max(2147483647).nullable().optional(),
  operationId: z.string().uuid(),
}).strict();

const moneyClassifyExpenseInputSchema = z.object({
  expenseId: uuidSchema,
  version: z.number().int().positive(),
  category: z.string().min(1),
  note: nullableStringSchema.optional(),
  needVsWant: z.enum(["need", "want"]).optional(),
  operationId: z.string().uuid(),
}).strict();

const moneyRecordCoffeeVisitInputSchema = z.object({
  visitKey: z.string().min(1).max(128),
  localDate: moneyMovementDateSchema,
  timezone: z.string().min(1).max(128),
  expenseIds: z.array(uuidSchema).min(1).max(50),
  note: nullableStringSchema.optional(),
  operationId: z.string().uuid(),
}).strict();

const moneyDeleteCoffeeVisitInputSchema = z.object({
  visitId: uuidSchema,
  version: z.number().int().positive(),
  operationId: z.string().uuid(),
}).strict();

const moneyCoffeeWindowInputSchema = z.object({
  localDate: moneyMovementDateSchema,
  timezone: z.string().min(1).max(128),
  periodStartDate: moneyMovementDateSchema,
  periodEndDate: moneyMovementDateSchema,
}).strict();

const moneyCoffeeVisitListInputSchema = z.object({
  from: moneyMovementDateSchema,
  to: moneyMovementDateSchema,
  limit: limitSchema,
  offset: offsetSchema,
}).strict();

const moneyObligationCreateInputSchema = z.object({
  kind: obligationKindSchema,
  description: z.string().min(1).max(200),
  amountMinor: z.number().int().positive().max(2147483647),
  dueDate: obligationDateSchema,
  periodStart: obligationDateSchema.optional(),
  periodEnd: obligationDateSchema.optional(),
  templateId: uuidSchema.nullable().optional(),
  needVsWant: obligationNeedVsWantSchema.nullable().optional(),
  purpose: obligationPurposeSchema.optional(),
  countsInDaily: z.boolean().optional(),
  category: obligationCategorySchema.nullable().optional(),
  stateEffectiveDate: obligationDateSchema,
  idempotencyKey: z.string().min(1).max(128),
  operationId: z.string().uuid(),
}).strict();

const moneyObligationUpdateInputSchema = z.object({
  obligationId: uuidSchema,
  version: z.number().int().positive(),
  description: z.string().min(1).max(200).optional(),
  amountMinor: z.number().int().positive().max(2147483647).optional(),
  periodStart: obligationDateSchema.optional(),
  periodEnd: obligationDateSchema.optional(),
  dueDate: obligationDateSchema.optional(),
  needVsWant: obligationNeedVsWantSchema.nullable().optional(),
  purpose: obligationPurposeSchema.optional(),
  countsInDaily: z.boolean().optional(),
  category: obligationCategorySchema.nullable().optional(),
  operationId: z.string().uuid(),
}).strict();

const moneyObligationTransitionInputSchema = z.object({
  obligationId: uuidSchema,
  version: z.number().int().positive(),
  to: obligationStateSchema,
  effectiveDate: obligationDateSchema,
  reason: z.string().max(200).nullable().optional(),
  operationId: z.string().uuid(),
}).strict();

const moneyObligationTemplateCreateInputSchema = z.object({
  kind: obligationKindSchema,
  description: z.string().min(1).max(200),
  amountMinor: z.number().int().positive().max(2147483647),
  cadence: obligationCadenceSchema,
  dueDayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  dueWeekday: z.number().int().min(0).max(6).nullable().optional(),
  startDate: obligationDateSchema,
  endDate: obligationDateSchema.nullable().optional(),
  needVsWant: obligationNeedVsWantSchema.nullable().optional(),
  purpose: obligationPurposeSchema.nullable().optional(),
  countsInDaily: z.boolean().nullable().optional(),
  category: obligationCategorySchema.nullable().optional(),
  idempotencyKey: z.string().min(1).max(128),
  operationId: z.string().uuid(),
}).strict();

const moneyObligationTemplateUpdateInputSchema = z.object({
  templateId: uuidSchema,
  version: z.number().int().positive(),
  description: z.string().min(1).max(200).optional(),
  amountMinor: z.number().int().positive().max(2147483647).optional(),
  cadence: obligationCadenceSchema.optional(),
  dueDayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  dueWeekday: z.number().int().min(0).max(6).nullable().optional(),
  startDate: obligationDateSchema.optional(),
  endDate: obligationDateSchema.nullable().optional(),
  needVsWant: obligationNeedVsWantSchema.nullable().optional(),
  purpose: obligationPurposeSchema.nullable().optional(),
  countsInDaily: z.boolean().nullable().optional(),
  category: obligationCategorySchema.nullable().optional(),
  lifecycle: z.enum(["active", "archived"]).optional(),
  operationId: z.string().uuid(),
}).strict();

const moneyObligationGenerateInputSchema = z.object({
  templateId: uuidSchema,
  throughDate: obligationDateSchema,
  operationId: z.string().uuid(),
}).strict();

const moneyObligationPayInputSchema = z.object({
  obligationId: uuidSchema,
  version: z.number().int().positive(),
  bookingDate: obligationDateSchema,
  needVsWant: obligationNeedVsWantSchema.nullable().optional(),
  countsInDaily: z.boolean().nullable().optional(),
  paymentMethod: z.string().min(1).max(32).nullable().optional(),
  operationId: z.string().uuid(),
}).strict();

const moneyObligationCorrectPaymentInputSchema = z.object({
  obligationId: uuidSchema,
  version: z.number().int().positive(),
  amountMinor: z.number().int().positive().max(2147483647),
  bookingDate: obligationDateSchema,
  countsInDaily: z.boolean().nullable().optional(),
  operationId: z.string().uuid(),
}).strict();

const moneyObligationUndoPaymentInputSchema = z.object({
  obligationId: uuidSchema,
  version: z.number().int().positive(),
  operationId: z.string().uuid(),
}).strict();

const moneyObligationReadOutputSchema = z.object({
  ok: z.literal(true),
}).passthrough();

const stopTimerInputSchema = z.object({
  sessionId: uuidSchema,
  operationId: z.string().uuid(),
}).strict();

const clearCompletedTodayInputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  operationId: z.string().uuid(),
}).strict();

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
    name: "ega_personal_ops_summary",
    register: (server, handlers) =>
      server.registerTool(
        "ega_personal_ops_summary",
        {
          title: "Personal operations summary",
          description:
            "Owner-resolved operating summary: tracking time plus canonical recorded spending for today, week-to-date and month-to-date, including coffee. Amounts are integer MAD centimes (11.00 MAD = 1100) and currency is MAD. When omitted, date and timezone resolve from the owner's context. `spending.available=false` means totals are unavailable, not zero. Requires the explicit personal_ops.read grant.",
          inputSchema: personalOpsSummaryInputSchema,
          outputSchema: personalOpsSummaryOutputSchema,
          annotations: READ_ONLY_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.personalOpsSummary(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_personal_ops_expenses_list",
    register: (server, handlers) =>
      server.registerTool(
        "ega_personal_ops_expenses_list",
        {
          title: "List personal expenses",
          description:
            "Owner expense list in integer MAD centimes with a bounded limit. `from`/`to` are inclusive local dates resolved with the supplied timezone (never assume UTC). Unknown merchant, payment method or note is null, not an empty invented value. Requires the explicit personal_ops.read grant.",
          inputSchema: personalOpsExpensesInputSchema,
          outputSchema: personalOpsListOutputSchema,
          annotations: READ_ONLY_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.personalOpsExpensesList(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_personal_ops_checkin_get",
    register: (server, handlers) =>
      server.registerTool(
        "ega_personal_ops_checkin_get",
        {
          title: "Get daily check-in",
          description: "Read one owner/local-date daily check-in. Requires the explicit personal_ops.read grant.",
          inputSchema: personalOpsCheckinInputSchema,
          outputSchema: personalOpsListOutputSchema,
          annotations: READ_ONLY_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.personalOpsCheckinGet(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_money_get",
    register: (server, handlers) =>
      server.registerTool(
        "ega_money_get",
        {
          title: "Get one Money expense",
          description:
            "Read one identified, non-deleted expense owned by the authenticated user. `expenseId` is the canonical ledger id returned by create/list; amounts are integer MAD centimes (11.00 MAD = 1100). Unknown merchant, payment method or note stays null. Requires personal_ops.read.",
          inputSchema: moneyExpenseIdInputSchema,
          outputSchema: personalOpsListOutputSchema,
          annotations: READ_ONLY_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.getMoneyExpense(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_money_ledger_list",
    register: (server, handlers) =>
      server.registerTool(
        "ega_money_ledger_list",
        {
          title: "List the Money ledger",
          description:
            "List active expenses newest first with stable (occurred_at, id) ordering. `from`/`to` are inclusive owner-local dates; when omitted, the owner's stored timezone resolves them. `offset` continues from `pagination.nextOffset` until null, so every page is reachable. Amounts are integer MAD centimes. Requires personal_ops.read.",
          inputSchema: moneyLedgerListInputSchema,
          outputSchema: personalOpsListOutputSchema,
          annotations: READ_ONLY_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.listMoneyLedger(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_money_state",
    register: (server, handlers) =>
      server.registerTool(
        "ega_money_state",
        {
          title: "Get Money period state",
          description:
            "Owner Money context. Returns `localToday` (real owner-local date), `activeDate` (the tracking date, which may lag today), the owner timezone, the selected/current period, opening cash and recorded cash through the active date in integer MAD centimes (11.00 MAD = 1100). `datesDiffer=true` means today and the active day are different. Use mode:'today' for actual today and mode:'active_day' for the tracking date; a date outside the period is reported with `periodRelation` instead of being moved. `opening.status='unknown'` is not zero; `cash.available=false` means cash is unknown/unavailable, not zero. History and legacy row review counts are included; unassigned legacy rows are never claimed reconciled. Requires the explicit personal_ops.read grant.",
          inputSchema: moneyStateInputSchema,
          outputSchema: moneyStateOutputSchema,
          annotations: READ_ONLY_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.moneyState(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_money_rollover_preview",
    register: (server, handlers) =>
      server.registerTool(
        "ega_money_rollover_preview",
        {
          title: "Preview a Money period rollover",
          description:
            "Preview the one explicit successor for a finished Money period. The source must be ended with every tracked day closed. Returns the default successor dates (the day after the source end, same inclusive length), the modeled closing cash, unpaid occurrences, regenerated occurrences, derived coffee week windows, and any choices or blockers. `choices` must be resolved by the owner: unpaid occurrences (keep_pending, carry_forward or cancel) and a modeled-versus-verified closing difference. `blockers` mean rollover cannot proceed. Unknown closing cash is never zero. Requires the explicit personal_ops.read grant.",
          inputSchema: moneyRolloverPreviewInputSchema,
          outputSchema: moneyStateOutputSchema,
          annotations: READ_ONLY_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.moneyRolloverPreview(
            getAuthInfo(ctx as unknown as ServerContext),
            input,
            getProtocolContext(ctx as unknown as ServerContext),
          ),
      ),
  },
  {
    name: "ega_money_movement_list",
    register: (server, handlers) =>
      server.registerTool(
        "ega_money_movement_list",
        {
          title: "List money movements",
          description:
            "List owner money movements in integer MAD centimes, newest booking date first. Kinds are expense, income, opening, savings_transfer and reconciliation_adjustment; non-expense rows have null category/needVsWant. from/to/cutoff are inclusive booking dates (never UTC assumptions); occurredAt is null when only the day is known. Requires the explicit personal_ops.read grant.",
          inputSchema: moneyMovementListInputSchema,
          outputSchema: personalOpsListOutputSchema,
          annotations: READ_ONLY_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.moneyMovementList(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_money_movement_get",
    register: (server, handlers) =>
      server.registerTool(
        "ega_money_movement_get",
        {
          title: "Get one money movement",
          description:
            "Read one identified, non-deleted money movement owned by the authenticated user, including kind, direction, booking date, the persisted countsInDaily flag, version and periodId. Requires the explicit personal_ops.read grant.",
          inputSchema: moneyMovementGetInputSchema,
          outputSchema: personalOpsListOutputSchema,
          annotations: READ_ONLY_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.moneyMovementGet(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_money_budget_get",
    register: (server, handlers) =>
      server.registerTool(
        "ega_money_budget_get",
        {
          title: "Get the period budget plan",
          description:
            "Read the one explicit budget plan for a canonical Money period identified by inclusive periodStartDate/periodEndDate. Returns `plan: null` when none exists (not a zero budget). Allocations, savings/emergency targets and coffee weekly limits are integer MAD centimes; the period dates are read from the period row. Requires the explicit personal_ops.read grant.",
          inputSchema: moneyBudgetGetInputSchema,
          outputSchema: personalOpsListOutputSchema,
          annotations: READ_ONLY_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.moneyBudgetGet(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_money_coffee_window",
    register: (server, handlers) =>
      server.registerTool(
        "ega_money_coffee_window",
        {
          title: "Get counted coffee usage",
          description:
            "Read counted coffee for the owner-local ISO week clipped to the selected period. Counted visits and counted visit spend come from canonical coffee expenses linked to counted visits; category coffee spending is a separate projection and uncounted purchases stay visible. Remaining limits and overshoot are resolved from the canonical period budget plan, never caller-supplied values. Requires the explicit personal_ops.read grant.",
          inputSchema: moneyCoffeeWindowInputSchema,
          outputSchema: personalOpsListOutputSchema,
          annotations: READ_ONLY_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.moneyCoffeeWindow(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_money_coffee_visits_list",
    register: (server, handlers) =>
      server.registerTool(
        "ega_money_coffee_visits_list",
        {
          title: "List counted coffee visits",
          description:
            "List counted coffee visits with their canonical expense lines in inclusive owner-local from/to dates, newest first. Each line carries the canonical expense amount/category; the visit stores no second amount. Requires the explicit personal_ops.read grant.",
          inputSchema: moneyCoffeeVisitListInputSchema,
          outputSchema: personalOpsListOutputSchema,
          annotations: READ_ONLY_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.moneyCoffeeVisitList(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_money_obligations_list",
    register: (server, handlers) =>
      server.registerTool(
        "ega_money_obligations_list",
        {
          title: "List Money obligations",
          description:
            "List bill/subscription obligation occurrences for the authenticated owner in due-date order. Bills and subscriptions are the same occurrence rows filtered by `kind`, with one payment state. Amounts are integer MAD centimes. `dueFrom`/`dueTo` are inclusive dates. `state` is the explicit lifecycle (pending, paid, waived, cancelled); only a linked payment can make an occurrence paid. Requires the explicit personal_ops.read grant.",
          inputSchema: moneyObligationsInputSchema,
          outputSchema: moneyObligationReadOutputSchema,
          annotations: READ_ONLY_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.moneyObligationsList(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_money_obligation_get",
    register: (server, handlers) =>
      server.registerTool(
        "ega_money_obligation_get",
        {
          title: "Get a Money obligation",
          description:
            "Read one obligation occurrence by id, including its version, lifecycle, effective date, snapshot classification and payment link/evidence. Unknown need/want is null, not invented. Requires the explicit personal_ops.read grant.",
          inputSchema: moneyObligationGetInputSchema,
          outputSchema: moneyObligationReadOutputSchema,
          annotations: READ_ONLY_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.moneyObligationGet(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_money_obligation_templates_list",
    register: (server, handlers) =>
      server.registerTool(
        "ega_money_obligation_templates_list",
        {
          title: "List Money obligation templates",
          description:
            "List recurring bill/subscription templates. Templates supply recurrence and classification defaults and never post cash; archived templates are hidden unless `includeArchived` is true. Requires the explicit personal_ops.read grant.",
          inputSchema: moneyObligationTemplatesInputSchema,
          outputSchema: moneyObligationReadOutputSchema,
          annotations: READ_ONLY_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.moneyObligationTemplatesList(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_money_obligation_summary",
    register: (server, handlers) =>
      server.registerTool(
        "ega_money_obligation_summary",
        {
          title: "Read Money obligation totals",
          description:
            "Read due, overdue, outstanding, paid, waived and cancelled totals at an inclusive owner-local cutoff. Totals use complete occurrences and say when the bounded list was truncated. Requires the explicit personal_ops.read grant.",
          inputSchema: moneyObligationSummaryInputSchema,
          outputSchema: moneyObligationReadOutputSchema,
          annotations: READ_ONLY_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.moneyObligationsSummary(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
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
    name: "ega_create_personal_ops_expense",
    register: (server, handlers) =>
      server.registerTool(
        "ega_create_personal_ops_expense",
        {
          title: "Create personal expense",
          description:
            "Create one MAD expense in the canonical ledger. amountMinor is integer centimes (11.00 MAD = 1100). occurredAt is an ISO timestamp; for an explicit local day send that day's timestamp with an offset rather than guessing UTC. note, merchant and paymentMethod may be null when unknown. idempotencyKey identifies this purchase: the same key and same full payload replays the original row; changing any field conflicts. The result returns the stored id, amount, resolved occurredAt and version. Requires the explicit personal_ops.write grant.",
          inputSchema: personalOpsExpenseInputSchema,
          outputSchema: genericWriteOutputSchema,
          annotations: WRITE_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.createPersonalOpsExpense(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_money_create_expense",
    register: (server, handlers) =>
      server.registerTool(
        "ega_money_create_expense",
        {
          title: "Create a Money expense",
          description:
            "Create one MAD expense in the canonical ledger. amountMinor is integer centimes (11.00 MAD = 1100). occurredAt is an ISO timestamp; send an explicit local day's timestamp with an offset rather than guessing UTC. note, merchant and paymentMethod may be null when unknown. idempotencyKey identifies this purchase: the same key and full payload replays the original row (including after deletion); any changed field conflicts. Returns the stored id, resolved occurredAt and version. Requires the explicit personal_ops.write grant.",
          inputSchema: moneyCreateExpenseInputSchema,
          outputSchema: genericWriteOutputSchema,
          annotations: WRITE_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.createMoneyExpense(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_money_update_expense",
    register: (server, handlers) =>
      server.registerTool(
        "ega_money_update_expense",
        {
          title: "Update a Money expense",
          description:
            "Edit one identified expense through the canonical use case. expectedVersion is the version from the latest get/list; a stale version returns CONFLICT and never overwrites newer data. Only supplied fields change; note/merchant/paymentMethod can be explicitly cleared with null and then stay unknown. Requires personal_ops.write.",
          inputSchema: moneyUpdateExpenseInputSchema,
          outputSchema: genericWriteOutputSchema,
          annotations: WRITE_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.updateMoneyExpense(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_money_delete_expense",
    register: (server, handlers) =>
      server.registerTool(
        "ega_money_delete_expense",
        {
          title: "Delete a Money expense",
          description:
            "Soft-delete one identified expense with its expectedVersion. A stale version returns CONFLICT; repeating the delete returns alreadyDeleted=true and never recreates or restores the row. Requires personal_ops.write.",
          inputSchema: moneyDeleteExpenseInputSchema,
          outputSchema: genericWriteOutputSchema,
          annotations: WRITE_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.deleteMoneyExpense(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_save_personal_ops_checkin",
    register: (server, handlers) =>
      server.registerTool(
        "ega_save_personal_ops_checkin",
        {
          title: "Save daily check-in",
          description: "Save or merge one owner/local-date daily check-in. Requires the explicit personal_ops.write grant.",
          inputSchema: personalOpsCheckinSaveInputSchema,
          outputSchema: genericWriteOutputSchema,
          annotations: WRITE_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.savePersonalOpsCheckin(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_money_update_settings",
    register: (server, handlers) =>
      server.registerTool(
        "ega_money_update_settings",
        {
          title: "Create a Money period or update its settings",
          description:
            "Create a period when startDate and endDate are supplied; otherwise update the selected/tracking period. Updates require the current `version` and fail on a stale version without overwriting. `activeDate` is the tracking day: changing it never changes the period boundaries, closes a day or resets transactions. `opening.amountMinor` is integer MAD centimes and zero is a valid known opening; omit `opening` to keep unknown cash unknown. A verified opening needs `cutoffDate` and evidence. This tool returns the stored period and its version, preserving update provenance. Requires the explicit personal_ops.write grant.",
          inputSchema: moneyUpdateSettingsInputSchema,
          outputSchema: genericWriteOutputSchema,
          annotations: WRITE_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.updateMoneySettings(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_money_rebase_day_start_baseline",
    register: (server, handlers) => server.registerTool(
      "ega_money_rebase_day_start_baseline",
      { title: "Complete or rebase Money day-start baseline", description: "For initial setup, first add the period's initial obligations, then call this tool to explicitly complete setup and record the baseline (an empty list is valid if there are none). For completed setup, explicitly rebase the baseline to current state. The response returns the stored baseline and setup status. Requires the explicit personal_ops.write grant.", inputSchema: moneyRebaseDayStartInputSchema, outputSchema: genericWriteOutputSchema, annotations: WRITE_ANNOTATIONS },
      async (input, ctx) => handlers.rebaseMoneyDayStartBaseline(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
    ),
  },
  {
    name: "ega_money_rollover_period",
    register: (server, handlers) =>
      server.registerTool(
        "ega_money_rollover_period",
        {
          title: "Roll over a finished Money period",
          description:
            "Explicitly roll one ended period into exactly one successor. Creates one successor period and one opening movement atomically, regenerates recurring obligation occurrences from the canonical templates with new period identities, and links the source as rolled_over. `opening.mode=carry_forward` carries the modeled closing cash and is labeled modeled; `verified_source` requires amountMinor, cutoffDate and evidence and is labeled reconciled. A nonzero modeled-versus-verified difference needs `acceptClosingDifferenceNote`. Unpaid source occurrences need an explicit `unpaidItems` treatment: keep_pending, carry_forward (one-off bills only) or cancel, with a reason. Paid rows are never copied as expenses. The same operationId replays its original successor; a stale `expectedVersion` conflicts. Requires the explicit personal_ops.write grant.",
          inputSchema: moneyRolloverInputSchema,
          outputSchema: genericWriteOutputSchema,
          annotations: WRITE_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.rolloverMoneyPeriod(
            getAuthInfo(ctx as unknown as ServerContext),
            input,
            getProtocolContext(ctx as unknown as ServerContext),
          ),
      ),
  },
  {
    name: "ega_money_create_movement",
    register: (server, handlers) =>
      server.registerTool(
        "ega_money_create_movement",
        {
          title: "Create money movement",
          description:
            "Record one money movement in the canonical ledger: received income, a savings transfer out of tracked spendable cash, a reconciliation adjustment, or an expense. amountMinor is positive integer MAD centimes (11.00 MAD = 1100); direction is derived from kind except for reconciliation_adjustment. bookingDate is the owner-local booking day; omit occurredAt when only the day is known. countsInDaily defaults true for expenses and false for other kinds; an explicit value persists. Unreceived income must not be posted. idempotencyKey identifies this movement: the same key and same full payload replays the original row; changing any field conflicts. Requires the explicit personal_ops.write grant.",
          inputSchema: moneyCreateMovementInputSchema,
          outputSchema: genericWriteOutputSchema,
          annotations: WRITE_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.createMoneyMovement(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_money_update_movement",
    register: (server, handlers) =>
      server.registerTool(
        "ega_money_update_movement",
        {
          title: "Correct money movement",
          description:
            "Correct one owned money movement with optimistic concurrency: `version` must be the current positive version and must match the stored row. Kind and direction are immutable; category, need/want and purpose apply only to expenses. A corrected savings transfer or income restates recorded cash exactly once. Include countsInDaily to change the durable daily-inclusion flag. Requires the explicit personal_ops.write grant.",
          inputSchema: moneyUpdateMovementInputSchema,
          outputSchema: genericWriteOutputSchema,
          annotations: WRITE_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.updateMoneyMovement(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_money_set_allocation",
    register: (server, handlers) =>
      server.registerTool(
        "ega_money_set_allocation",
        {
          title: "Set a period budget allocation",
          description:
            "Edit one canonical period budget plan with optimistic concurrency. `version: 0` creates the plan; any other value must match the current plan version. Omitted fields stay unchanged and explicit null clears an allocation or target. Allocations, savings/emergency targets and coffee weekly spend/visit limits are whole non-negative MAD centimes (visits are whole numbers). Routine spending never changes these values. Requires the explicit personal_ops.write grant.",
          inputSchema: moneySetAllocationInputSchema,
          outputSchema: genericWriteOutputSchema,
          annotations: WRITE_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.setMoneyAllocation(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_money_classify_expense",
    register: (server, handlers) =>
      server.registerTool(
        "ega_money_classify_expense",
        {
          title: "Classify an expense category",
          description:
            "Explicitly reclassify one owned expense with optimistic concurrency. This is an ordinary versioned expense update: it increases the chosen category and never creates a counted coffee visit. 'Coffee, classify as groceries for testing' keeps its description/override, increases groceries spending and leaves counted coffee usage unchanged; the receipt reports affected counted visit ids. Requires the explicit personal_ops.write grant.",
          inputSchema: moneyClassifyExpenseInputSchema,
          outputSchema: genericWriteOutputSchema,
          annotations: WRITE_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.classifyMoneyExpense(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_money_record_coffee_visit",
    register: (server, handlers) =>
      server.registerTool(
        "ega_money_record_coffee_visit",
        {
          title: "Count a coffee visit",
          description:
            "Link one or more canonical coffee-category expense ids to one counted visit. `visitKey` is the stable retry identity: the same key and same payload replays the stored visit; the same key with different lines conflicts. Several purchase lines count as one visit and never add a second cash effect. Requires the explicit personal_ops.write grant.",
          inputSchema: moneyRecordCoffeeVisitInputSchema,
          outputSchema: genericWriteOutputSchema,
          annotations: WRITE_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.recordCoffeeVisit(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_money_delete_coffee_visit",
    register: (server, handlers) =>
      server.registerTool(
        "ega_money_delete_coffee_visit",
        {
          title: "Delete a counted coffee visit",
          description:
            "Delete one owned counted coffee visit and its lines with `version` fencing. The canonical expenses remain and keep their recorded cash effect; only the visit metadata is removed. Requires the explicit personal_ops.write grant.",
          inputSchema: moneyDeleteCoffeeVisitInputSchema,
          outputSchema: genericWriteOutputSchema,
          annotations: WRITE_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.deleteCoffeeVisit(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_money_create_obligation",
    register: (server, handlers) =>
      server.registerTool(
        "ega_money_create_obligation",
        {
          title: "Create a Money obligation occurrence",
          description:
            "Create one bill/subscription obligation occurrence in `pending` state. Scheduling is not a cash movement. `dueDate` must fall inside the period; `periodStart`/`periodEnd` default to the due date for a one-off bill. Optional `templateId` supplies classification defaults, which the occurrence snapshots so later template edits do not rewrite it. Need/want may be omitted while unknown; it is requested at payment and never fabricated. `stateEffectiveDate` is the date the pending state takes effect (owner-local). The idempotencyKey binds the full payload: same key + same payload replays, a changed payload conflicts. Requires the explicit personal_ops.write grant.",
          inputSchema: moneyObligationCreateInputSchema,
          outputSchema: genericWriteOutputSchema,
          annotations: WRITE_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.createMoneyObligation(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_money_update_obligation",
    register: (server, handlers) =>
      server.registerTool(
        "ega_money_update_obligation",
        {
          title: "Edit a Money obligation occurrence",
          description:
            "Edit one occurrence with the expected positive `version`. Amount, period, due date and classification are editable while pending; a paid occurrence is settled by its linked payment and can only be relabelled here (correct the payment through the atomic MONEY-07 path). Requires the explicit personal_ops.write grant.",
          inputSchema: moneyObligationUpdateInputSchema,
          outputSchema: genericWriteOutputSchema,
          annotations: WRITE_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.updateMoneyObligation(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_money_transition_obligation",
    register: (server, handlers) =>
      server.registerTool(
        "ega_money_transition_obligation",
        {
          title: "Cancel, waive or reopen a Money obligation",
          description:
            "Apply one explicit lifecycle transition with the expected `version`: `to:'cancelled'` cancels, `to:'waived'` waives, `to:'pending'` reopens (restoring full reserve). The inclusive `effectiveDate` is retained for historical reconstruction and cannot precede the current state. No transition moves cash. `to:'paid'` is rejected here — a paid occurrence requires one atomically linked ledger payment through MONEY-07; a status change cannot manufacture cash history. Requires the explicit personal_ops.write grant.",
          inputSchema: moneyObligationTransitionInputSchema,
          outputSchema: genericWriteOutputSchema,
          annotations: WRITE_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.transitionMoneyObligation(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_money_create_obligation_template",
    register: (server, handlers) =>
      server.registerTool(
        "ega_money_create_obligation_template",
        {
          title: "Create a recurring obligation template",
          description:
            "Create a recurring bill/subscription template. Weekly templates use `dueWeekday` (0=Sunday); monthly and longer cadences use `dueDayOfMonth` (1–31, clamped to shorter months). Templates are recurrence/classification defaults only: they never post cash and never rewrite occurrences already generated. Requires the explicit personal_ops.write grant.",
          inputSchema: moneyObligationTemplateCreateInputSchema,
          outputSchema: genericWriteOutputSchema,
          annotations: WRITE_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.createMoneyObligationTemplate(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_money_update_obligation_template",
    register: (server, handlers) =>
      server.registerTool(
        "ega_money_update_obligation_template",
        {
          title: "Edit or archive a recurring obligation template",
          description:
            "Edit a template with the expected positive `version`, or set `lifecycle` to active/archived. Editing a template does not change previously generated occurrences (they snapshot their own classification). Requires the explicit personal_ops.write grant.",
          inputSchema: moneyObligationTemplateUpdateInputSchema,
          outputSchema: genericWriteOutputSchema,
          annotations: WRITE_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.updateMoneyObligationTemplate(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_money_generate_obligations",
    register: (server, handlers) =>
      server.registerTool(
        "ega_money_generate_obligations",
        {
          title: "Generate obligation occurrences from a template",
          description:
            "Materialise template occurrences through the inclusive `throughDate`. Generation is idempotent per template period (one occurrence per owner+template+period), bounded per call and reports `truncated` when the cap stopped short. No cash moves. Requires the explicit personal_ops.write grant.",
          inputSchema: moneyObligationGenerateInputSchema,
          outputSchema: genericWriteOutputSchema,
          annotations: WRITE_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.generateMoneyObligations(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_money_pay_obligation",
    register: (server, handlers) =>
      server.registerTool(
        "ega_money_pay_obligation",
        {
          title: "Pay a Money obligation",
          description:
            "Pay one pending bill or subscription. The payment records exactly one canonical ledger outflow and settles the occurrence in a single transaction, so a failure leaves neither half committed. The amount is always the occurrence's own amount: partial and overpayment are not supported. `needVsWant` is required while the occurrence has not classified it; `countsInDaily` defaults to false for a fixed obligation and an explicit value always wins. The `operationId` is the retry identity: the same operation replays the original receipt, and a different operation cannot pay an already-paid occurrence. Requires the explicit personal_ops.write grant.",
          inputSchema: moneyObligationPayInputSchema,
          outputSchema: genericWriteOutputSchema,
          annotations: WRITE_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.payMoneyObligation(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_money_correct_obligation_payment",
    register: (server, handlers) =>
      server.registerTool(
        "ega_money_correct_obligation_payment",
        {
          title: "Correct a Money obligation payment",
          description:
            "Correct the linked ledger payment of a paid obligation: the amount, the booking date and the daily-inclusion flag move together with the occurrence in one transaction, so the pair stays coherent. A generic expense edit cannot change a linked payment. The `operationId` is the retry identity of the correction. Requires the explicit personal_ops.write grant.",
          inputSchema: moneyObligationCorrectPaymentInputSchema,
          outputSchema: genericWriteOutputSchema,
          annotations: WRITE_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.correctMoneyObligationPayment(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
      ),
  },
  {
    name: "ega_money_undo_obligation_payment",
    register: (server, handlers) =>
      server.registerTool(
        "ega_money_undo_obligation_payment",
        {
          title: "Undo a Money obligation payment",
          description:
            "Undo the linked ledger payment of a paid obligation. The ledger outflow is removed and the obligation returns to pending in one transaction, so cash and the outstanding reserve are restored together. The `operationId` is the retry identity of the undo. Requires the explicit personal_ops.write grant.",
          inputSchema: moneyObligationUndoPaymentInputSchema,
          outputSchema: genericWriteOutputSchema,
          annotations: WRITE_ANNOTATIONS,
        },
        async (input, ctx) =>
          handlers.undoMoneyObligationPayment(getAuthInfo(ctx as unknown as ServerContext), input, getProtocolContext(ctx as unknown as ServerContext)),
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
