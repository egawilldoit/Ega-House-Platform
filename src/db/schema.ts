import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
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
    boardRank: text("board_rank"),
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
    index("tasks_owner_status_board_rank_idx").on(
      table.ownerUserId,
      table.status,
      table.boardRank,
    ),
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
    check(
      "tasks_board_rank_format_check",
      sql`${table.boardRank} is null or (length(${table.boardRank}) between 1 and 512 and ${table.boardRank} ~ '^[0-9A-Z]+$')`,
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

export const inboxIdempotencyKeys = pgTable(
  "inbox_idempotency_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").default(sql`auth.uid()`).notNull(),
    key: varchar("key", { length: 128 }).notNull(),
    inboxItemId: uuid("inbox_item_id")
      .notNull()
      .references(() => ideaNotes.id, { onDelete: "cascade" }),
    fingerprint: text("fingerprint"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("inbox_idempotency_keys_owner_key_unique").on(
      table.ownerUserId,
      table.key,
    ),
    index("inbox_idempotency_keys_owner_idx").on(table.ownerUserId),
    index("inbox_idempotency_keys_inbox_item_id_idx").on(table.inboxItemId),
    check("inbox_idempotency_keys_key_not_blank", sql`length(btrim(${table.key})) > 0`),
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
    actorKind: varchar("actor_kind", { length: 16 }).notNull().default("unknown"),
    actorUserId: uuid("actor_user_id"),
    actorAgentId: text("actor_agent_id"),
    actorLabel: text("actor_label"),
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
    check(
      "task_sessions_actor_kind_check",
      sql`${table.actorKind} in ('owner', 'agent', 'system', 'unknown')`,
    ),
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
    deliveryMode: varchar("delivery_mode", { length: 32 }).notNull().default("email"),
    status: varchar("status", { length: 32 }).notNull().default("pending"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    processingError: text("processing_error"),
    source: varchar("source", { length: 64 }),
    sourceId: varchar("source_id", { length: 256 }),
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
    index("task_reminders_pending_by_remind_at_idx")
      .on(table.status, table.remindAt)
      .where(sql`${table.status} = 'pending'`),
    uniqueIndex("task_reminders_owner_source_source_id_unique")
      .on(table.ownerUserId, table.source, table.sourceId)
      .where(sql`${table.source} is not null and ${table.sourceId} is not null`),
    check(
      "task_reminders_delivery_mode_check",
      sql`${table.deliveryMode} in ('push', 'email', 'both')`,
    ),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").default(sql`auth.uid()`).notNull(),
    type: varchar("type", { length: 32 }).notNull(),
    title: varchar("title", { length: 512 }).notNull(),
    body: text("body"),
    targetType: varchar("target_type", { length: 32 }),
    targetId: uuid("target_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("notifications_owner_idempotency_unique").on(table.ownerUserId, table.idempotencyKey),
    index("notifications_owner_created_idx").on(table.ownerUserId, table.createdAt.desc()),
    index("notifications_owner_unread_idx")
      .on(table.ownerUserId, table.createdAt.desc())
      .where(sql`${table.readAt} is null`),
    check(
      "notifications_type_check",
      sql`${table.type} in ('task_reminder', 'task_comment_mention')`,
    ),
    check(
      "notifications_target_type_check",
      sql`${table.targetType} is null or ${table.targetType} in ('task')`,
    ),
  ],
);

export const notificationDevices = pgTable(
  "notification_devices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").default(sql`auth.uid()`).notNull(),
    installationId: text("installation_id").notNull(),
    platform: varchar("platform", { length: 16 }).notNull(),
    provider: varchar("provider", { length: 16 }).notNull(),
    providerToken: text("provider_token").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("notification_devices_installation_unique").on(table.installationId),
    uniqueIndex("notification_devices_provider_token_active_unique")
      .on(table.providerToken)
      .where(sql`${table.isActive} = true`),
    index("notification_devices_owner_idx").on(table.ownerUserId),
    index("notification_devices_provider_token_idx").on(table.providerToken),
    index("notification_devices_owner_active_idx")
      .on(table.ownerUserId, table.isActive)
      .where(sql`${table.isActive} = true`),
    check("notification_devices_platform_check", sql`${table.platform} in ('android')`),
    check("notification_devices_provider_check", sql`${table.provider} in ('fcm')`),
  ],
);

export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    notificationId: uuid("notification_id")
      .notNull()
      .references(() => notifications.id, { onDelete: "cascade" }),
    ownerUserId: uuid("owner_user_id").default(sql`auth.uid()`).notNull(),
    channel: varchar("channel", { length: 16 }).notNull(),
    deviceId: uuid("device_id").references(() => notificationDevices.id, { onDelete: "set null" }),
    provider: varchar("provider", { length: 16 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("queued"),
    providerMessageId: text("provider_message_id"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    lastErrorReason: text("last_error_reason"),
    providerAcceptedAt: timestamp("provider_accepted_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("notification_deliveries_unique_per_target").on(
      table.notificationId,
      table.channel,
      table.deviceId,
    ),
    index("notification_deliveries_status_retry_idx").on(table.status, table.nextAttemptAt),
    index("notification_deliveries_notification_idx").on(table.notificationId),
    index("notification_deliveries_owner_idx").on(table.ownerUserId),
    check(
      "notification_deliveries_channel_check",
      sql`${table.channel} in ('push', 'email')`,
    ),
    check(
      "notification_deliveries_provider_check",
      sql`${table.provider} in ('fcm', 'resend')`,
    ),
    check(
      "notification_deliveries_status_check",
      sql`${table.status} in ('queued', 'sending', 'provider_accepted', 'retry_scheduled', 'invalid_endpoint', 'failed')`,
    ),
    check("notification_deliveries_attempts_check", sql`${table.attemptCount} >= 0`),
  ],
);

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").default(sql`auth.uid()`).notNull(),
    notificationType: varchar("notification_type", { length: 32 }).notNull(),
    pushEnabled: boolean("push_enabled").notNull().default(true),
    emailEnabled: boolean("email_enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("notification_preferences_owner_type_unique").on(table.ownerUserId, table.notificationType),
    index("notification_preferences_owner_idx").on(table.ownerUserId),
    check(
      "notification_preferences_type_check",
      sql`${table.notificationType} in ('task_reminder')`,
    ),
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
export const taskStatusEvents = pgTable(
  "task_status_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").default(sql`auth.uid()`).notNull(),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    fromStatus: varchar("from_status", { length: 64 }),
    toStatus: varchar("to_status", { length: 64 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    actorKind: varchar("actor_kind", { length: 16 }).notNull().default("unknown"),
    actorUserId: uuid("actor_user_id"),
    actorAgentId: text("actor_agent_id"),
    actorLabel: text("actor_label"),
    operationMetadata: jsonb("operation_metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("task_status_events_owner_user_id_occurred_at_idx").on(table.ownerUserId, table.occurredAt),
    index("task_status_events_owner_user_id_task_id_occurred_at_idx").on(
      table.ownerUserId,
      table.taskId,
      table.occurredAt,
    ),
    check(
      "task_status_events_actor_kind_check",
      sql`${table.actorKind} in ('owner', 'agent', 'system', 'unknown')`,
    ),
  ],
);

/**
 * Server-owned undo receipts for bounded bulk operations (EGA-786).
 *
 * Each receipt records the fields one operation changed and the values before
 * and after. Undo re-reads the task, refuses if the after-values no longer hold,
 * restores only the recorded fields and marks the receipt consumed. Receipts
 * expire and are never deleted by the client; they are the audit trail.
 */
export const taskOperationReceipts = pgTable(
  "task_operation_receipts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").default(sql`auth.uid()`).notNull(),
    operationId: uuid("operation_id").notNull(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    action: varchar("action", { length: 32 }).notNull(),
    beforeValues: jsonb("before_values").notNull(),
    afterValues: jsonb("after_values").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
  },
  (table) => [
    index("task_operation_receipts_owner_operation_idx").on(table.ownerUserId, table.operationId),
    index("task_operation_receipts_owner_task_idx").on(table.ownerUserId, table.taskId),
    uniqueIndex("task_operation_receipts_operation_task_unique").on(
      table.operationId,
      table.taskId,
    ),
    check(
      "task_operation_receipts_action_check",
      sql`${table.action} in ('archive', 'restore', 'patch')`,
    ),
  ],
);

/**
 * Ordered checklist items inside a task (EGA-782). These are deliberately not
 * tasks: no timers, reminders, recurrence or completion evidence are copied or
 * shared, and completion of every item never completes the parent task.
 */
export const taskSubtasks = pgTable(
  "task_subtasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").default(sql`auth.uid()`).notNull(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 256 }).notNull(),
    done: boolean("done").notNull().default(false),
    position: integer("position").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("task_subtasks_task_position_idx").on(table.taskId, table.position),
    index("task_subtasks_owner_idx").on(table.ownerUserId),
    check("task_subtasks_title_not_blank", sql`length(btrim(${table.title})) > 0`),
    check("task_subtasks_position_check", sql`${table.position} >= 0`),
  ],
);

/**
 * Durable task activity ledger for observable field changes (EGA-784).
 *
 * Append-only for product clients: rows are written by a SECURITY DEFINER
 * trigger on `tasks`, so a client cannot forge history. Status transitions stay
 * in `task_status_events` (the analytics ledger); the activity read model unions
 * both plus timer session evidence.
 */
export const taskActivityEvents = pgTable(
  "task_activity_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").default(sql`auth.uid()`).notNull(),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    actorKind: varchar("actor_kind", { length: 16 }).notNull(),
    actorUserId: uuid("actor_user_id"),
    actorAgentId: text("actor_agent_id"),
    actorLabel: text("actor_label"),
    eventKind: varchar("event_kind", { length: 32 }).notNull(),
    delta: jsonb("delta").notNull(),
    sourceEventId: varchar("source_event_id", { length: 128 }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("task_activity_events_owner_task_time_idx").on(
      table.ownerUserId,
      table.taskId,
      table.occurredAt,
    ),
    uniqueIndex("task_activity_events_source_unique")
      .on(table.ownerUserId, table.eventKind, table.sourceEventId)
      .where(sql`${table.sourceEventId} is not null`),
    check(
      "task_activity_events_actor_kind_check",
      sql`${table.actorKind} in ('owner', 'agent', 'system', 'unknown')`,
    ),
    check(
      "task_activity_events_event_kind_check",
      sql`${table.eventKind} in ('created', 'field_change', 'archived', 'restored', 'reminder_scheduled', 'reminder_updated', 'reminder_cancelled', 'comment')`,
    ),
  ],
);

/**
 * Durable navigation favourites (EGA-787). Distinct from `tasks.focus_rank`
 * (Today ranking): a favourite is a sidebar/page shortcut for a project or task.
 * Polymorphic entity references are validated against the owner in the RLS
 * WITH CHECK, so an arbitrary UUID plus owner id is not enough.
 */
export const favorites = pgTable(
  "favorites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").default(sql`auth.uid()`).notNull(),
    entityKind: varchar("entity_kind", { length: 16 }).notNull(),
    entityId: uuid("entity_id").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("favorites_owner_entity_unique").on(
      table.ownerUserId,
      table.entityKind,
      table.entityId,
    ),
    index("favorites_owner_position_idx").on(table.ownerUserId, table.position),
    check("favorites_entity_kind_check", sql`${table.entityKind} in ('project', 'task')`),
    check("favorites_position_check", sql`${table.position} >= 0`),
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

/**
 * Owner-scoped task comment thread (EGA-783).
 *
 * Author identity is stable: `authorRef` is `owner` or `agent:<slug(name)>`,
 * while `authorTokenId` only records which credential wrote the row. Token
 * rotation/revocation therefore keeps historical attribution. Writes go through
 * the security-definer RPCs in migration 0070; product clients are read-only.
 */
export const taskComments = pgTable(
  "task_comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").default(sql`auth.uid()`).notNull(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    authorKind: varchar("author_kind", { length: 16 }).notNull(),
    authorUserId: uuid("author_user_id"),
    authorTokenId: uuid("author_token_id").references(
      () => agentIntegrationTokens.id,
      { onDelete: "set null" },
    ),
    authorRef: text("author_ref").notNull(),
    authorLabel: text("author_label").notNull(),
    body: text("body").notNull(),
    clientRequestId: text("client_request_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("task_comments_owner_request_unique").on(
      table.ownerUserId,
      table.clientRequestId,
    ),
    index("task_comments_owner_task_time_idx").on(
      table.ownerUserId,
      table.taskId,
      table.createdAt,
    ),
    index("task_comments_author_ref_idx").on(table.ownerUserId, table.authorRef),
    check(
      "task_comments_author_kind_check",
      sql`${table.authorKind} in ('owner', 'agent')`,
    ),
    check(
      "task_comments_author_ref_check",
      sql`((${table.authorKind} = 'owner' and ${table.authorRef} = 'owner') or (${table.authorKind} = 'agent' and ${table.authorRef} ~ '^agent:[a-z0-9][a-z0-9-]{0,62}$'))`,
    ),
    check(
      "task_comments_body_length_check",
      sql`char_length(${table.body}) between 1 and 4000`,
    ),
    check(
      "task_comments_request_id_check",
      sql`char_length(${table.clientRequestId}) between 1 and 128`,
    ),
  ],
);

export const taskCommentMentions = pgTable(
  "task_comment_mentions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").default(sql`auth.uid()`).notNull(),
    commentId: uuid("comment_id")
      .notNull()
      .references(() => taskComments.id, { onDelete: "cascade" }),
    mentionKind: varchar("mention_kind", { length: 16 }).notNull(),
    mentionRef: text("mention_ref").notNull(),
    mentionLabel: text("mention_label").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("task_comment_mentions_comment_ref_unique").on(
      table.commentId,
      table.mentionRef,
    ),
    index("task_comment_mentions_owner_idx").on(table.ownerUserId),
    check(
      "task_comment_mentions_kind_check",
      sql`${table.mentionKind} in ('owner', 'agent')`,
    ),
    check(
      "task_comment_mentions_ref_check",
      sql`((${table.mentionKind} = 'owner' and ${table.mentionRef} = 'owner') or (${table.mentionKind} = 'agent' and ${table.mentionRef} ~ '^agent:[a-z0-9][a-z0-9-]{0,62}$'))`,
    ),
  ],
);

export const taskCommentReactions = pgTable(
  "task_comment_reactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").default(sql`auth.uid()`).notNull(),
    commentId: uuid("comment_id")
      .notNull()
      .references(() => taskComments.id, { onDelete: "cascade" }),
    actorKind: varchar("actor_kind", { length: 16 }).notNull(),
    actorUserId: uuid("actor_user_id"),
    actorTokenId: uuid("actor_token_id").references(
      () => agentIntegrationTokens.id,
      { onDelete: "set null" },
    ),
    actorRef: text("actor_ref").notNull(),
    actorLabel: text("actor_label").notNull(),
    emoji: varchar("emoji", { length: 32 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("task_comment_reactions_comment_actor_emoji_unique").on(
      table.commentId,
      table.actorRef,
      table.emoji,
    ),
    index("task_comment_reactions_owner_comment_idx").on(
      table.ownerUserId,
      table.commentId,
    ),
    check(
      "task_comment_reactions_actor_kind_check",
      sql`${table.actorKind} in ('owner', 'agent')`,
    ),
    check(
      "task_comment_reactions_actor_ref_check",
      sql`((${table.actorKind} = 'owner' and ${table.actorRef} = 'owner') or (${table.actorKind} = 'agent' and ${table.actorRef} ~ '^agent:[a-z0-9][a-z0-9-]{0,62}$'))`,
    ),
    check(
      "task_comment_reactions_emoji_check",
      sql`${table.emoji} in ('👍', '👀', '✅', '🎉', '🙏', '🔥')`,
    ),
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
    foreignKey({
      columns: [table.parentProposalId],
      foreignColumns: [table.id],
      name: "operator_proposals_parent_proposal_id_fkey",
    }).onDelete("set null"),
  ],
);
