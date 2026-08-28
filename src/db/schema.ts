import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").default(sql`auth.uid()`),
    name: varchar("name", { length: 256 }).notNull(),
    slug: varchar("slug", { length: 256 }).notNull(),
    description: text("description"),
    status: varchar("status", { length: 64 }).notNull().default("planned"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("projects_owner_user_id_idx").on(table.ownerUserId),
    uniqueIndex("projects_owner_user_id_slug_unique").on(
      table.ownerUserId,
      table.slug,
    ),
  ],
);



export const goals = pgTable(
  "goals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").default(sql`auth.uid()`),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    title: varchar("title", { length: 256 }).notNull(),
    slug: varchar("slug", { length: 256 }),
    description: text("description"),
    nextStep: text("next_step"),
    health: varchar("health", { length: 32 }),
    status: varchar("status", { length: 64 }).notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("goals_owner_user_id_idx").on(table.ownerUserId)],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").default(sql`auth.uid()`),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    goalId: uuid("goal_id").references(() => goals.id),
    title: varchar("title", { length: 256 }).notNull(),
    description: text("description"),
    blockedReason: text("blocked_reason"),
    status: varchar("status", { length: 64 }).notNull().default("todo"),
    priority: varchar("priority", { length: 32 }).notNull().default("medium"),
    estimateMinutes: integer("estimate_minutes"),
    focusRank: integer("focus_rank"),
    dueDate: date("due_date"),
    plannedForDate: date("planned_for_date"),
    scheduledStartAt: timestamp("scheduled_start_at", { withTimezone: true }),
    scheduledEndAt: timestamp("scheduled_end_at", { withTimezone: true }),
    calendarSyncEnabled: boolean("calendar_sync_enabled").notNull().default(false),
    calendarReminderMinutes: integer("calendar_reminder_minutes").notNull().default(10),
    calendarEventId: text("calendar_event_id"),
    calendarSyncStatus: varchar("calendar_sync_status", { length: 32 }),
    calendarSyncFailureReason: text("calendar_sync_failure_reason"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archivedBy: uuid("archived_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("tasks_owner_user_id_idx").on(table.ownerUserId),
    index("tasks_owner_user_id_focus_rank_idx").on(table.ownerUserId, table.focusRank),
    index("tasks_owner_user_id_planned_for_date_idx").on(table.ownerUserId, table.plannedForDate),
    index("tasks_owner_user_id_scheduled_start_at_idx").on(table.ownerUserId, table.scheduledStartAt),
    index("tasks_owner_active_updated_idx")
      .on(table.ownerUserId, table.updatedAt.desc())
      .where(sql`${table.archivedAt} is null`),
    index("tasks_owner_archived_updated_idx")
      .on(table.ownerUserId, table.archivedAt.desc())
      .where(sql`${table.archivedAt} is not null`),
    check(
      "tasks_scheduled_window_check",
      sql`(
        (${table.scheduledStartAt} is null and ${table.scheduledEndAt} is null)
        or
        (${table.scheduledStartAt} is not null and ${table.scheduledEndAt} is not null and ${table.scheduledStartAt} < ${table.scheduledEndAt})
      )`,
    ),
    check(
      "tasks_calendar_sync_status_check",
      sql`${table.calendarSyncStatus} is null or ${table.calendarSyncStatus} in ('pending', 'synced', 'failed', 'skipped')`,
    ),
  ],
);

export const calendarIntegrationSettings = pgTable(
  "calendar_integration_settings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").default(sql`auth.uid()`).notNull(),
    provider: varchar("provider", { length: 32 }).notNull().default("google"),
    googleAccountEmail: text("google_account_email"),
    scheduledTaskSyncEnabled: boolean("scheduled_task_sync_enabled")
      .notNull()
      .default(false),
    defaultReminderMinutes: integer("default_reminder_minutes")
      .notNull()
      .default(10),
    calendarId: text("calendar_id").notNull().default("primary"),
    accessTokenEncrypted: text("access_token_encrypted"),
    refreshTokenEncrypted: text("refresh_token_encrypted"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("calendar_integration_settings_owner_user_id_idx").on(table.ownerUserId),
    uniqueIndex("calendar_integration_settings_owner_provider_unique").on(
      table.ownerUserId,
      table.provider,
    ),
    check(
      "calendar_integration_settings_provider_check",
      sql`${table.provider} in ('google')`,
    ),
    check(
      "calendar_integration_settings_default_reminder_check",
      sql`${table.defaultReminderMinutes} >= 0 and ${table.defaultReminderMinutes} <= 10080`,
    ),
  ],
);

export const agentIntegrationEvents = pgTable("agent_integration_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerUserId: uuid("owner_user_id").notNull(),
  tokenId: uuid("token_id").notNull(),
  action: varchar("action", { length: 64 }).notNull(),
  resourceType: varchar("resource_type", { length: 32 }),
  resourceId: uuid("resource_id"),
  outcome: varchar("outcome", { length: 16 }).notNull(), // "success" | "failure"
  ipAddress: varchar("ip_address", { length: 45 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const taskExternalRefs = pgTable("task_external_refs", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerUserId: uuid("owner_user_id").notNull(),
  taskId: uuid("task_id").notNull().references(() => tasks.id),
  source: varchar("source", { length: 64 }).notNull(),
  sourceId: varchar("source_id", { length: 256 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("task_external_refs_owner_source_source_id_unique").on(table.ownerUserId, table.source, table.sourceId),
  index("task_external_refs_owner_idx").on(table.ownerUserId),
]);

export const calendarSyncJobs = pgTable(
  "calendar_sync_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").notNull(),
    taskId: uuid("task_id").notNull(),
    calendarEventId: text("calendar_event_id"),
    operation: varchar("operation", { length: 16 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("calendar_sync_jobs_pending_idx")
      .on(table.status, table.createdAt)
      .where(sql`${table.status} in ('pending', 'failed')`),
    index("calendar_sync_jobs_task_id_idx").on(table.taskId),
    index("calendar_sync_jobs_owner_user_id_idx").on(table.ownerUserId),
    check(
      "calendar_sync_jobs_operation_check",
      sql`${table.operation} in ('upsert', 'delete')`,
    ),
    check(
      "calendar_sync_jobs_status_check",
      sql`${table.status} in ('pending', 'processing', 'succeeded', 'failed')`,
    ),
    check("calendar_sync_jobs_attempts_check", sql`${table.attempts} >= 0`),
  ],
);

export const ideaNotes = pgTable(
  "idea_notes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").default(sql`auth.uid()`).notNull(),
    title: text("title").notNull(),
    body: text("body"),
    status: text("status").notNull().default("inbox"),
    type: text("type").notNull().default("idea"),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    priority: text("priority"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idea_notes_owner_status_created_idx").on(
      table.ownerUserId,
      table.status,
      table.createdAt.desc(),
    ),
    index("idea_notes_owner_updated_idx").on(
      table.ownerUserId,
      table.updatedAt.desc(),
    ),
    index("idea_notes_owner_type_created_idx").on(
      table.ownerUserId,
      table.type,
      table.createdAt.desc(),
    ),
    index("idea_notes_owner_priority_created_idx").on(
      table.ownerUserId,
      table.priority,
      table.createdAt.desc(),
    ),
    index("idea_notes_tags_gin_idx").using("gin", table.tags),
    check(
      "idea_notes_status_check",
      sql`${table.status} in ('inbox', 'reviewing', 'planned', 'archived', 'converted')`,
    ),
  ],
);

export const taskSessions = pgTable(
  "task_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").default(sql`auth.uid()`),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    durationSeconds: integer("duration_seconds"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("task_sessions_owner_user_id_idx").on(table.ownerUserId),
    uniqueIndex("task_sessions_owner_open_unique")
      .on(table.ownerUserId)
      .where(sql`${table.endedAt} is null`),
  ],
);

export const taskReminders = pgTable(
  "task_reminders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").default(sql`auth.uid()`),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    remindAt: timestamp("remind_at", { withTimezone: true }).notNull(),
    channel: varchar("channel", { length: 32 }).notNull().default("email"),
    status: varchar("status", { length: 32 }).notNull().default("pending"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("task_reminders_owner_user_id_idx").on(table.ownerUserId),
    index("task_reminders_task_id_idx").on(table.taskId),
    index("task_reminders_pending_delivery_idx")
      .on(table.status, table.channel, table.remindAt)
      .where(sql`${table.status} = 'pending'`),
  ],
);

export const taskRecurrences = pgTable(
  "task_recurrences",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").default(sql`auth.uid()`),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    rule: varchar("rule", { length: 64 }).notNull(),
    anchorDate: date("anchor_date").notNull(),
    timezone: varchar("timezone", { length: 128 }).notNull(),
    nextOccurrenceDate: date("next_occurrence_date").notNull(),
    lastGeneratedAt: timestamp("last_generated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("task_recurrences_owner_user_id_idx").on(table.ownerUserId),
    index("task_recurrences_task_id_idx").on(table.taskId),
    uniqueIndex("task_recurrences_task_id_unique").on(table.taskId),
    check(
      "task_recurrences_rule_check",
      sql`${table.rule} in ('daily', 'weekdays', 'weekly:sunday', 'weekly:monday', 'weekly:tuesday', 'weekly:wednesday', 'weekly:thursday', 'weekly:friday', 'weekly:saturday', 'monthly:day-of-month')`,
    ),
  ],
);
export const taskSavedViews = pgTable(
  "task_saved_views",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").default(sql`auth.uid()`),
    name: varchar("name", { length: 80 }).notNull(),
    status: varchar("status", { length: 64 }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    goalId: uuid("goal_id").references(() => goals.id, { onDelete: "set null" }),
    dueFilter: varchar("due_filter", { length: 32 }).notNull().default("all"),
    sortValue: varchar("sort_value", { length: 32 })
      .notNull()
      .default("updated_desc"),
    definitionJson: jsonb("definition_json"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("task_saved_views_owner_user_id_idx").on(table.ownerUserId),
    uniqueIndex("task_saved_views_owner_user_id_name_unique").on(
      table.ownerUserId,
      table.name,
    ),
  ],
);

export const weekReviews = pgTable(
  "week_reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").default(sql`auth.uid()`),
    weekStart: date("week_start").notNull(),
    weekEnd: date("week_end").notNull(),
    summary: text("summary"),
    wins: text("wins"),
    blockers: text("blockers"),
    nextSteps: text("next_steps"),
    officialEmailStatus: varchar("official_email_status", { length: 32 }),
    officialEmailClaimedAt: timestamp("official_email_claimed_at", { withTimezone: true }),
    officialEmailSentAt: timestamp("official_email_sent_at", { withTimezone: true }),
    officialEmailMessageId: text("official_email_message_id"),
    officialEmailFailureReason: text("official_email_failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("week_reviews_owner_user_id_idx").on(table.ownerUserId),
    index("week_reviews_official_email_delivery_idx").on(
      table.ownerUserId,
      table.weekStart,
      table.officialEmailStatus,
      table.officialEmailSentAt,
    ),
    uniqueIndex("week_reviews_owner_user_id_week_start_unique").on(
      table.ownerUserId,
      table.weekStart,
    ),
  ],
);

export const agentIntegrationTokens = pgTable(
  "agent_integration_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").notNull(),
    name: varchar("name", { length: 256 }).notNull(),
    tokenPrefix: varchar("token_prefix", { length: 16 }).notNull(),
    tokenHash: text("token_hash").notNull(),
    scopes: jsonb("scopes").notNull().default(sql`'{}'::jsonb`),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("agent_token_prefix_unique").on(table.tokenPrefix),
    index("agent_tokens_owner_idx").on(table.ownerUserId),
  ],
);

export const userTimeContext = pgTable("user_time_context", {
  userId: uuid("user_id").default(sql`auth.uid()`).primaryKey(),
  ianaTimezone: varchar("iana_timezone", { length: 128 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const operatorProposals = pgTable(
  "operator_proposals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    revision: integer("revision").notNull(),
    ownerUserId: uuid("owner_user_id").default(sql`auth.uid()`).notNull(),
    localDate: date("local_date").notNull(),
    timeContextId: varchar("time_context_id", { length: 256 }).notNull(),
    baselineHash: text("baseline_hash").notNull(),
    proposedTaskIds: jsonb("proposed_task_ids").notNull().default(sql`'[]'::jsonb`),
    taskVersions: jsonb("task_versions").notNull().default(sql`'[]'::jsonb`),
    parentProposalId: uuid("parent_proposal_id"),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    status: varchar("status", { length: 32 }).notNull().default("generated"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    result: jsonb("result"),
    aiRef: text("ai_ref"),
  },
  (table) => [
    index("operator_proposals_owner_user_id_idx").on(table.ownerUserId),
    index("operator_proposals_owner_local_date_idx").on(table.ownerUserId, table.localDate),
    index("operator_proposals_owner_status_idx").on(table.ownerUserId, table.status),
    index("operator_proposals_owner_created_at_idx").on(table.ownerUserId, table.createdAt.desc()),
    index("operator_proposals_parent_id_idx").on(table.parentProposalId),
    uniqueIndex("operator_proposals_owner_idempotency_key_unique").on(
      table.ownerUserId,
      table.idempotencyKey,
    ),
    check(
      "operator_proposals_revision_check",
      sql`${table.revision} > 0`,
    ),
    check(
      "operator_proposals_status_check",
      sql`${table.status} in ('generated','revised','approved','applying','applied','partially_applied','stale','dismissed')`,
    ),
    check(
      "operator_proposals_idempotency_key_not_blank",
      sql`length(btrim(${table.idempotencyKey})) > 0`,
    ),
  ],
);
