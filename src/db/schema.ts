import { sql } from "drizzle-orm";
import {
  bigint,
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

export const areas = pgTable(
  "areas",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").default(sql`auth.uid()`),
    name: varchar("name", { length: 80 }).notNull(),
    icon: varchar("icon", { length: 32 }).notNull().default("folder"),
    color: varchar("color", { length: 32 }).notNull().default("slate"),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("areas_owner_user_id_idx").on(table.ownerUserId),
    uniqueIndex("areas_owner_user_id_name_unique").on(
      table.ownerUserId,
      table.name,
    ),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").default(sql`auth.uid()`),
    areaId: uuid("area_id").references(() => areas.id, {
      onDelete: "set null",
    }),
    name: varchar("name", { length: 256 }).notNull(),
    slug: varchar("slug", { length: 256 }).notNull(),
    description: text("description"),
    status: varchar("status", { length: 64 }).notNull().default("planned"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archivedBy: uuid("archived_by"),
    templateOperationId: uuid("template_operation_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("projects_owner_user_id_idx").on(table.ownerUserId),
    index("projects_owner_user_id_area_id_idx").on(
      table.ownerUserId,
      table.areaId,
    ),
    uniqueIndex("projects_owner_user_id_slug_unique").on(
      table.ownerUserId,
      table.slug,
    ),
    index("projects_owner_user_id_archived_at_idx")
      .on(table.ownerUserId, table.archivedAt.desc())
      .where(sql`${table.archivedAt} is not null`),
    check(
      "projects_archive_state_check",
      sql`(${table.archivedAt} is not null) = (${table.status} = 'archived')`,
    ),
    uniqueIndex("projects_template_operation_unique")
      .on(table.ownerUserId, table.templateOperationId)
      .where(sql`${table.templateOperationId} is not null`),
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
    index("goals_owner_user_id_idx").on(table.ownerUserId),
    index("goals_owner_user_id_archived_at_idx")
      .on(table.ownerUserId, table.archivedAt.desc())
      .where(sql`${table.archivedAt} is not null`),
    check(
      "goals_archive_state_check",
      sql`(${table.archivedAt} is not null) = (${table.status} = 'archived')`,
    ),
  ],
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
    startDate: date("start_date"),
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
    index("tasks_owner_user_id_start_date_idx").on(table.ownerUserId, table.startDate),
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
    check(
      "tasks_date_window_check",
      sql`${table.startDate} is null or ${table.dueDate} is null or ${table.dueDate} >= ${table.startDate}`,
    ),
  ],
);

export const taskDependencies = pgTable(
  "task_dependencies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").default(sql`auth.uid()`).notNull(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    blockedByTaskId: uuid("blocked_by_task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("task_dependencies_owner_edge_unique").on(
      table.ownerUserId,
      table.taskId,
      table.blockedByTaskId,
    ),
    index("task_dependencies_owner_task_idx").on(table.ownerUserId, table.taskId),
    index("task_dependencies_owner_blocked_by_idx").on(
      table.ownerUserId,
      table.blockedByTaskId,
    ),
    check(
      "task_dependencies_no_self_check",
      sql`${table.taskId} <> ${table.blockedByTaskId}`,
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
  /** Stable registry identity; null for legacy/unassigned agent credentials. */
  agentId: uuid("agent_id").references(() => agentActors.id, {
    onDelete: "set null",
  }),
  /** Snapshot of the identity display name at write time. */
  agentLabel: text("agent_label"),
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
      sql`${table.type} in ('task_reminder', 'task_comment_mention', 'timer_state_change', 'routine_reminder', 'money_threshold', 'daily_review', 'weekly_review', 'job_search_reminder')`,
    ),
    check(
      "notifications_target_type_check",
      sql`${table.targetType} is null or ${table.targetType} in ('task', 'timer', 'routine', 'money', 'review', 'today')`,
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
    uniqueIndex("notification_deliveries_unique_coalesce").on(
      table.notificationId,
      table.channel,
      sql`coalesce(${table.deviceId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
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
      sql`${table.status} in ('queued', 'sending', 'provider_accepted', 'retry_scheduled', 'invalid_endpoint', 'failed', 'suppressed')`,
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
      sql`${table.notificationType} in ('task_reminder', 'task_comment_mention', 'timer_state_change', 'routine_reminder', 'money_threshold', 'daily_review', 'weekly_review', 'job_search_reminder')`,
    ),
  ],
);

export const notificationSettings = pgTable(
  "notification_settings",
  {
    ownerUserId: uuid("owner_user_id").default(sql`auth.uid()`).primaryKey(),
    quietHoursEnabled: boolean("quiet_hours_enabled").notNull().default(false),
    quietHoursStart: varchar("quiet_hours_start", { length: 5 }).notNull().default("22:00"),
    quietHoursEnd: varchar("quiet_hours_end", { length: 5 }).notNull().default("07:00"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "notification_settings_quiet_hours_start_check",
      sql`${table.quietHoursStart} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
    ),
    check(
      "notification_settings_quiet_hours_end_check",
      sql`${table.quietHoursEnd} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
    ),
    check(
      "notification_settings_quiet_hours_window_check",
      sql`${table.quietHoursStart} <> ${table.quietHoursEnd}`,
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
 * Owner-scoped task attachments (EGA-802).
 *
 * Metadata and the private Storage object are separate resources. Rows start
 * `pending`, become `finalized` only after the server has verified the stored
 * bytes, and are written exclusively through SECURITY DEFINER functions; the
 * only client grant is SELECT under owner + parent-task RLS. `storage_path` is
 * built by the database as `<owner>/<task>/<attachment>.<ext>`.
 */
export const taskAttachments = pgTable(
  "task_attachments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").default(sql`auth.uid()`).notNull(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    storagePath: text("storage_path").notNull(),
    mimeType: varchar("mime_type", { length: 128 }).notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    uploadExpiresAt: timestamp("upload_expires_at", { withTimezone: true }).notNull(),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("task_attachments_owner_idempotency_key_unique").on(
      table.ownerUserId,
      table.idempotencyKey,
    ),
    uniqueIndex("task_attachments_storage_path_unique").on(table.storagePath),
    index("task_attachments_owner_task_created_idx").on(
      table.ownerUserId,
      table.taskId,
      table.createdAt,
    ),
    index("task_attachments_owner_pending_idx")
      .on(table.ownerUserId, table.uploadExpiresAt)
      .where(sql`${table.status} = 'pending'`),
    index("task_attachments_task_status_created_idx").on(
      table.taskId,
      table.status,
      table.createdAt,
    ),
    check("task_attachments_file_name_not_blank", sql`length(btrim(${table.fileName})) > 0`),
    check("task_attachments_file_name_length", sql`length(${table.fileName}) <= 180`),
    check(
      "task_attachments_size_check",
      sql`${table.sizeBytes} > 0 and ${table.sizeBytes} <= 10485760`,
    ),
    check(
      "task_attachments_status_check",
      sql`${table.status} in ('pending', 'finalized', 'failed')`,
    ),
    check(
      "task_attachments_mime_type_check",
      sql`${table.mimeType} in ('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'text/markdown', 'text/csv')`,
    ),
    check(
      "task_attachments_idempotency_key_not_blank",
      sql`length(btrim(${table.idempotencyKey})) >= 8`,
    ),
    check(
      "task_attachments_finalized_at_check",
      sql`(${table.status} = 'finalized') = (${table.finalizedAt} is not null)`,
    ),
  ],
);

/**
 * Durable task activity ledger for observable field changes (EGA-784).
 *
 * Append-only for product clients: rows are written by a SECURITY DEFINER
 * trigger on `tasks`, so a client cannot forge history. Status transitions stay
 * in `task_status_events` (the analytics ledger); the activity read model unions
 * both plus timer session evidence.
 */export const taskActivityEvents = pgTable(
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
      sql`${table.eventKind} in ('created', 'field_change', 'archived', 'restored', 'reminder_scheduled', 'reminder_updated', 'reminder_cancelled', 'comment', 'attachment_added', 'attachment_removed')`,
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

/**
 * Stable agent identity (EGA-800).
 *
 * Credentials are revocable capabilities linked to this identity. Historical
 * activity stores the identity id plus a display-name snapshot, so rotating or
 * revoking a token never rewrites attribution. `kind` and `role` are
 * owner-declared presentation only; neither grants access.
 */
export const agentActors = pgTable(
  "agent_actors",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").default(sql`auth.uid()`).notNull(),
    displayName: varchar("display_name", { length: 80 }).notNull(),
    kind: varchar("kind", { length: 24 }).notNull(),
    role: varchar("role", { length: 64 }),
    avatarColor: varchar("avatar_color", { length: 16 }).notNull().default("slate"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("agent_actors_owner_name_unique").on(
      table.ownerUserId,
      sql`lower(${table.displayName})`,
    ),
    index("agent_actors_owner_created_idx").on(table.ownerUserId, table.createdAt.desc()),
    check(
      "agent_actors_kind_check",
      sql`${table.kind} in ('t3', 'opencode', 'codex', 'runner', 'custom')`,
    ),
    check(
      "agent_actors_avatar_color_check",
      sql`${table.avatarColor} in ('blue', 'violet', 'green', 'amber', 'slate', 'rose')`,
    ),
    check(
      "agent_actors_display_name_check",
      sql`length(btrim(${table.displayName})) between 1 and 80`,
    ),
    check(
      "agent_actors_role_check",
      sql`${table.role} is null or length(btrim(${table.role})) between 1 and 64`,
    ),
  ],
);

export const agentIntegrationTokens = pgTable(
  "agent_integration_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").notNull(),
    /** Nullable for legacy credentials issued before the registry existed. */
    agentId: uuid("agent_id").references(() => agentActors.id, {
      onDelete: "set null",
    }),
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
    index("agent_tokens_owner_agent_idx").on(table.ownerUserId, table.agentId),
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

/**
 * Durable workspace preferences (EGA-798). One row per owner; a missing row
 * means the documented defaults, so pre-existing accounts keep today's
 * behaviour. `user_id` defaults to the verified request identity and is never
 * supplied by the client.
 */
export const userPreferences = pgTable(
  "user_preferences",
  {
    userId: uuid("user_id").default(sql`auth.uid()`).primaryKey(),
    theme: varchar("theme", { length: 16 }).default("system").notNull(),
    accent: varchar("accent", { length: 16 }).default("neutral").notNull(),
    density: varchar("density", { length: 16 }).default("comfortable").notNull(),
    reducedMotion: boolean("reduced_motion").default(false).notNull(),
    launchPage: varchar("launch_page", { length: 16 }).default("home").notNull(),
    taskLayout: varchar("task_layout", { length: 16 }).default("list").notNull(),
    taskOpenMode: varchar("task_open_mode", { length: 16 }).default("panel").notNull(),
    personalOperations: jsonb("personal_operations"),
    jobSearchReference: jsonb("job_search_reference"),
    categoryCaps: jsonb("category_caps"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("user_preferences_personal_operations_check", sql`public.valid_personal_operations(${table.personalOperations})`),
    check("user_preferences_job_search_reference_check", sql`public.valid_job_search_reference(${table.jobSearchReference})`),
    check("user_preferences_category_caps_check", sql`public.valid_category_caps(${table.categoryCaps})`),
    check(
      "user_preferences_theme_check",
      sql`${table.theme} in ('system', 'light', 'dark')`,
    ),
    check(
      "user_preferences_accent_check",
      sql`${table.accent} in ('neutral', 'blue', 'green', 'violet', 'amber')`,
    ),
    check(
      "user_preferences_density_check",
      sql`${table.density} in ('comfortable', 'compact')`,
    ),
    check(
      "user_preferences_launch_page_check",
      sql`${table.launchPage} in ('home', 'today', 'tasks')`,
    ),
    check(
      "user_preferences_task_layout_check",
      sql`${table.taskLayout} in ('list', 'kanban')`,
    ),
    check(
      "user_preferences_task_open_mode_check",
      sql`${table.taskOpenMode} in ('panel', 'full')`,
    ),
  ],
);

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

/**
 * Owner-scoped personal expense ledger (PO-06 Slice A, issue #346). Amounts
 * are positive integer centimes of MAD; soft delete and optimistic version
 * concurrency keep the ledger bounded and idempotent. The BEFORE UPDATE
 * mutation guard lives in drizzle/0088_personal_expenses.sql because Drizzle
 * cannot express triggers.
 */
export const personalExpenses = pgTable(
  "personal_expenses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").default(sql`auth.uid()`).notNull(),
    kind: varchar("kind", { length: 32 }).default("expense").notNull(),
    direction: varchar("direction", { length: 8 }).default("out").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    bookingDate: date("booking_date").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: varchar("currency", { length: 3 }).default("MAD").notNull(),
    category: varchar("category", { length: 32 }),
    note: varchar("note", { length: 500 }),
    merchant: varchar("merchant", { length: 120 }),
    needVsWant: varchar("need_vs_want", { length: 8 }),
    paymentMethod: varchar("payment_method", { length: 32 }),
    purpose: varchar("purpose", { length: 16 }),
    countsInDaily: boolean("counts_in_daily").notNull(),
    periodId: uuid("period_id"),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    createFingerprint: varchar("create_fingerprint", { length: 64 }).notNull(),
    version: integer("version").default(1).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("personal_expenses_owner_idempotency_key_unique").on(
      table.ownerUserId,
      table.idempotencyKey,
    ),
    index("personal_expenses_owner_occurred_at_idx").on(
      table.ownerUserId,
      table.occurredAt.desc(),
      table.id.desc(),
    ),
    index("personal_expenses_owner_booking_date_idx").on(
      table.ownerUserId,
      table.bookingDate.desc(),
      table.id.desc(),
    ),
    check(
      "personal_expenses_amount_minor_check",
      sql`${table.amountMinor} <= 2147483647 and ((${table.kind} = 'opening' and ${table.amountMinor} >= 0) or (${table.kind} <> 'opening' and ${table.amountMinor} >= 1))`,
    ),
    check("personal_expenses_currency_check", sql`${table.currency} = 'MAD'`),
    check(
      "personal_expenses_kind_check",
      sql`${table.kind} in ('expense','income','opening','savings_transfer','reconciliation_adjustment')`,
    ),
    check(
      "personal_expenses_direction_check",
      sql`${table.direction} in ('in','out')`,
    ),
    check(
      "personal_expenses_purpose_check",
      sql`${table.purpose} is null or ${table.purpose} in ('fixed','flexible','emergency')`,
    ),
    check(
      "personal_expenses_kind_shape_check",
      sql`(
        (${table.kind} = 'expense' and ${table.direction} = 'out' and ${table.category} is not null and ${table.needVsWant} is not null)
        or (${table.kind} in ('income','opening') and ${table.direction} = 'in' and ${table.category} is null and ${table.needVsWant} is null and ${table.purpose} is null)
        or (${table.kind} = 'savings_transfer' and ${table.direction} = 'out' and ${table.category} is null and ${table.needVsWant} is null and ${table.purpose} is null)
        or (${table.kind} = 'reconciliation_adjustment' and ${table.direction} in ('in','out') and ${table.category} is null and ${table.needVsWant} is null and ${table.purpose} is null)
      )`,
    ),
    check(
      "personal_expenses_category_check",
      sql`${table.category} is null or ${table.category} in ('coffee','groceries','eating_out','transport','bills','subscriptions','household','health','other','daily_usage','personal_care','work_tools','fun','emergency')`,
    ),
    check(
      "personal_expenses_need_vs_want_check",
      sql`${table.needVsWant} is null or ${table.needVsWant} in ('need','want')`,
    ),
    check(
      "personal_expenses_payment_method_check",
      sql`${table.paymentMethod} is null or ${table.paymentMethod} in ('cash','card','bank_transfer','mobile_wallet','other')`,
    ),
    check("personal_expenses_version_check", sql`${table.version} > 0`),
    check(
      "personal_expenses_idempotency_key_check",
      sql`length(btrim(${table.idempotencyKey})) > 0`,
    ),
    check(
      "personal_expenses_create_fingerprint_check",
      sql`${table.createFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "personal_expenses_note_check",
      sql`${table.note} is null or length(btrim(${table.note})) > 0`,
    ),
    check(
      "personal_expenses_merchant_check",
      sql`${table.merchant} is null or length(btrim(${table.merchant})) > 0`,
    ),
  ],
);

/**
 * Canonical Money period (MONEY-03). One owner may have at most one tracking
 * period and one row per inclusive date range; the opening movement is
 * referenced, never duplicated.
 */
export const moneyPeriods = pgTable(
  "money_periods",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").default(sql`auth.uid()`).notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    currency: varchar("currency", { length: 3 }).default("MAD").notNull(),
    timezone: varchar("timezone", { length: 128 }).notNull(),
    activeDate: date("active_date").notNull(),
    lifecycle: varchar("lifecycle", { length: 16 }).default("tracking").notNull(),
    initialization: varchar("initialization", { length: 16 })
      .default("uninitialized")
      .notNull(),
    openingMovementId: uuid("opening_movement_id"),
    provenance: jsonb("provenance").default(sql`'{}'::jsonb`).notNull(),
    settings: jsonb("settings").default(sql`'{}'::jsonb`).notNull(),
    version: integer("version").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("money_periods_owner_tracking_unique")
      .on(table.ownerUserId)
      .where(sql`lifecycle = 'tracking'`),
    uniqueIndex("money_periods_owner_id_unique").on(
      table.ownerUserId,
      table.id,
    ),
    uniqueIndex("money_periods_owner_range_unique").on(
      table.ownerUserId,
      table.startDate,
      table.endDate,
    ),
    index("money_periods_owner_history_idx").on(
      table.ownerUserId,
      table.startDate.desc(),
      table.id.desc(),
    ),
    check("money_periods_range_check", sql`${table.startDate} <= ${table.endDate}`),
    check("money_periods_currency_check", sql`${table.currency} = 'MAD'`),
    check(
      "money_periods_active_date_check",
      sql`${table.activeDate} >= ${table.startDate} and ${table.activeDate} <= ${table.endDate}`,
    ),
    check("money_periods_timezone_check", sql`btrim(${table.timezone}) <> ''`),
    check(
      "money_periods_lifecycle_check",
      sql`${table.lifecycle} in ('tracking','ended','rolled_over')`,
    ),
    check(
      "money_periods_initialization_check",
      sql`${table.initialization} in ('uninitialized','initialized','reconciled')`,
    ),
    check("money_periods_version_check", sql`${table.version} > 0`),
  ],
);

/**
 * MONEY-09 durable day close. One immutable row per owner/period/date retains
 * the CLOSED note, the calculated day totals, the chosen day-start baseline, the
 * algorithm/policy version and the close identity. The active-date transition
 * and this insert happen in one `money_close_day` transaction. Later
 * corrections never rewrite the snapshot; reads compute restated totals.
 */
export const moneyDayCloses = pgTable(
  "money_day_closes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id")
      .default(sql`auth.uid()`)
      .notNull(),
    periodId: uuid("period_id").notNull(),
    closeDate: date("close_date").notNull(),
    status: varchar("status", { length: 16 }).default("closed").notNull(),
    note: text("note"),
    operationId: uuid("operation_id").notNull(),
    closeFingerprint: varchar("close_fingerprint", { length: 64 }).notNull(),
    expectedPeriodVersion: integer("expected_period_version").notNull(),
    periodVersionAfter: integer("period_version_after").notNull(),
    activeDateAfter: date("active_date_after").notNull(),
    lifecycleAfter: varchar("lifecycle_after", { length: 16 }).notNull(),
    isFinalDay: boolean("is_final_day").notNull(),
    algorithmVersion: varchar("algorithm_version", { length: 64 }).notNull(),
    policyVersionId: uuid("policy_version_id"),
    policyVersion: integer("policy_version"),
    baselineVersion: integer("baseline_version").notNull(),
    includedMovementIds: uuid("included_movement_ids")
      .array()
      .default(sql`'{}'::uuid[]`)
      .notNull(),
    snapshot: jsonb("snapshot").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("money_day_closes_owner_operation_unique").on(
      table.ownerUserId,
      table.operationId,
    ),
    uniqueIndex("money_day_closes_owner_period_date_unique").on(
      table.ownerUserId,
      table.periodId,
      table.closeDate,
    ),
    index("money_day_closes_owner_period_history_idx").on(
      table.ownerUserId,
      table.periodId,
      table.closeDate.desc(),
      table.createdAt.desc(),
    ),
    foreignKey({
      columns: [table.ownerUserId, table.periodId],
      foreignColumns: [moneyPeriods.ownerUserId, moneyPeriods.id],
    }).onDelete("restrict"),
    check("money_day_closes_status_check", sql`${table.status} = 'closed'`),
    check(
      "money_day_closes_fingerprint_check",
      sql`${table.closeFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "money_day_closes_version_check",
      sql`${table.expectedPeriodVersion} > 0 and ${table.periodVersionAfter} = ${table.expectedPeriodVersion} + 1`,
    ),
    check(
      "money_day_closes_lifecycle_check",
      sql`${table.lifecycleAfter} in ('tracking','ended')`,
    ),
    check(
      "money_day_closes_final_day_check",
      sql`(${table.isFinalDay} and ${table.lifecycleAfter} = 'ended') or (not ${table.isFinalDay} and ${table.lifecycleAfter} = 'tracking')`,
    ),
    check(
      "money_day_closes_advance_check",
      sql`(${table.lifecycleAfter} <> 'ended' or ${table.closeDate} = ${table.activeDateAfter}) and (${table.lifecycleAfter} <> 'tracking' or ${table.activeDateAfter} = ${table.closeDate} + 1)`,
    ),
    check(
      "money_day_closes_baseline_version_check",
      sql`${table.baselineVersion} > 0`,
    ),
    check(
      "money_day_closes_snapshot_check",
      sql`jsonb_typeof(${table.snapshot}) = 'object'`,
    ),
  ],
);

/**
 * MONEY-05 budget plan: exactly one editable allocation/target/coffee-limit
 * owner per canonical period. Routine spending never writes these values.
 */
export const moneyBudgetPlans = pgTable(
  "money_budget_plans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").default(sql`auth.uid()`).notNull(),
    periodId: uuid("period_id")
      .notNull()
      .references(() => moneyPeriods.id, { onDelete: "cascade" }),
    currency: varchar("currency", { length: 3 }).default("MAD").notNull(),
    allocations: jsonb("allocations").default(sql`'{}'::jsonb`).notNull(),
    savingsTargetMinor: integer("savings_target_minor"),
    emergencyTargetMinor: integer("emergency_target_minor"),
    coffeeWeeklySpendLimitMinor: integer("coffee_weekly_spend_limit_minor"),
    coffeeWeeklyVisitLimit: integer("coffee_weekly_visit_limit"),
    version: integer("version").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("money_budget_plans_owner_period_unique").on(
      table.ownerUserId,
      table.periodId,
    ),
    check("money_budget_plans_currency_check", sql`${table.currency} = 'MAD'`),
    check("money_budget_plans_version_check", sql`${table.version} > 0`),
  ],
);

/**
 * MONEY-05 counted coffee visit. The visit stores identity and owner-local
 * date only; its lines reference canonical ledger rows and never duplicate an
 * amount or create a cash movement.
 */
export const moneyCoffeeVisits = pgTable(
  "money_coffee_visits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").default(sql`auth.uid()`).notNull(),
    visitKey: varchar("visit_key", { length: 128 }).notNull(),
    visitFingerprint: varchar("visit_fingerprint", { length: 64 }).notNull(),
    localDate: date("local_date").notNull(),
    timezone: varchar("timezone", { length: 64 }).notNull(),
    note: varchar("note", { length: 500 }),
    version: integer("version").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("money_coffee_visits_owner_key_unique").on(
      table.ownerUserId,
      table.visitKey,
    ),
    index("money_coffee_visits_owner_local_date_idx").on(
      table.ownerUserId,
      table.localDate.desc(),
      table.id.desc(),
    ),
    check("money_coffee_visits_key_check", sql`btrim(${table.visitKey}) <> ''`),
    check(
      "money_coffee_visits_fingerprint_check",
      sql`${table.visitFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check("money_coffee_visits_version_check", sql`${table.version} > 0`),
  ],
);

export const moneyCoffeeVisitLines = pgTable(
  "money_coffee_visit_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").default(sql`auth.uid()`).notNull(),
    visitId: uuid("visit_id")
      .notNull()
      .references(() => moneyCoffeeVisits.id, { onDelete: "cascade" }),
    expenseId: uuid("expense_id")
      .notNull()
      .references(() => personalExpenses.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("money_coffee_visit_lines_owner_expense_unique").on(
      table.ownerUserId,
      table.expenseId,
    ),
    index("money_coffee_visit_lines_owner_visit_idx").on(
      table.ownerUserId,
      table.visitId,
    ),
  ],
);

/**
 * Recurring bill/subscription template (MONEY-06). Supplies recurrence and
 * classification defaults only; it never posts a cash movement and never
 * rewrites occurrences already generated from it. The lifecycle/version guard
 * lives in drizzle/0098_money_06_obligations.sql because Drizzle cannot
 * express triggers.
 */
export const moneyObligationTemplates = pgTable(
  "money_obligation_templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").default(sql`auth.uid()`).notNull(),
    kind: varchar("kind", { length: 16 }).notNull(),
    description: varchar("description", { length: 200 }).notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: varchar("currency", { length: 3 }).default("MAD").notNull(),
    cadence: varchar("cadence", { length: 16 }).notNull(),
    dueDayOfMonth: integer("due_day_of_month"),
    dueWeekday: integer("due_weekday"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    needVsWant: varchar("need_vs_want", { length: 8 }),
    purpose: varchar("purpose", { length: 16 }),
    countsInDaily: boolean("counts_in_daily"),
    category: varchar("category", { length: 32 }),
    lifecycle: varchar("lifecycle", { length: 16 }).default("active").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    createFingerprint: varchar("create_fingerprint", { length: 64 }).notNull(),
    version: integer("version").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("money_obligation_templates_owner_idempotency_key_unique").on(
      table.ownerUserId,
      table.idempotencyKey,
    ),
    index("money_obligation_templates_owner_kind_idx").on(
      table.ownerUserId,
      table.kind,
      table.createdAt.desc(),
    ),
    check(
      "money_obligation_templates_kind_check",
      sql`${table.kind} in ('bill','subscription')`,
    ),
    check(
      "money_obligation_templates_amount_minor_check",
      sql`${table.amountMinor} >= 1 and ${table.amountMinor} <= 2147483647`,
    ),
    check(
      "money_obligation_templates_currency_check",
      sql`${table.currency} = 'MAD'`,
    ),
    check(
      "money_obligation_templates_cadence_check",
      sql`${table.cadence} in ('weekly','monthly','quarterly','semiannual','annual')`,
    ),
    check(
      "money_obligation_templates_schedule_check",
      sql`(${table.cadence} = 'weekly' and ${table.dueWeekday} between 0 and 6 and ${table.dueDayOfMonth} is null) or (${table.cadence} <> 'weekly' and ${table.dueDayOfMonth} between 1 and 31 and ${table.dueWeekday} is null)`,
    ),
    check(
      "money_obligation_templates_dates_check",
      sql`${table.endDate} is null or ${table.endDate} >= ${table.startDate}`,
    ),
    check(
      "money_obligation_templates_need_vs_want_check",
      sql`${table.needVsWant} is null or ${table.needVsWant} in ('need','want')`,
    ),
    check(
      "money_obligation_templates_purpose_check",
      sql`${table.purpose} is null or ${table.purpose} in ('fixed','flexible','emergency')`,
    ),
    check(
      "money_obligation_templates_lifecycle_check",
      sql`${table.lifecycle} in ('active','archived')`,
    ),
    check(
      "money_obligation_templates_version_check",
      sql`${table.version} > 0`,
    ),
    check(
      "money_obligation_templates_create_fingerprint_check",
      sql`${table.createFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

/**
 * One durable obligation occurrence (MONEY-06). Bills and subscriptions are
 * the same rows projected differently; there is no second paid flag. `paid`
 * requires exactly one linked `personal_expenses` payment (unique) or explicit
 * reconciled historical import evidence. Lifecycle, version and payment-link
 * guards live in drizzle/0098_money_06_obligations.sql.
 */
export const moneyObligations = pgTable(
  "money_obligations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").default(sql`auth.uid()`).notNull(),
    templateId: uuid("template_id").references(
      () => moneyObligationTemplates.id,
      { onDelete: "set null" },
    ),
    kind: varchar("kind", { length: 16 }).notNull(),
    description: varchar("description", { length: 200 }).notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: varchar("currency", { length: 3 }).default("MAD").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    dueDate: date("due_date").notNull(),
    needVsWant: varchar("need_vs_want", { length: 8 }),
    purpose: varchar("purpose", { length: 16 }).notNull(),
    countsInDaily: boolean("counts_in_daily").notNull(),
    category: varchar("category", { length: 32 }),
    state: varchar("state", { length: 16 }).default("pending").notNull(),
    stateEffectiveDate: date("state_effective_date").notNull(),
    stateReason: varchar("state_reason", { length: 200 }),
    stateHistory: jsonb("state_history").default(sql`'[]'::jsonb`).notNull(),
    paymentExpenseId: uuid("payment_expense_id").references(
      () => personalExpenses.id,
      { onDelete: "restrict" },
    ),
    paymentEvidence: jsonb("payment_evidence"),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    createFingerprint: varchar("create_fingerprint", { length: 64 }).notNull(),
    version: integer("version").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("money_obligations_owner_idempotency_key_unique").on(
      table.ownerUserId,
      table.idempotencyKey,
    ),
    uniqueIndex("money_obligations_template_period_unique")
      .on(table.ownerUserId, table.templateId, table.periodStart)
      .where(sql`${table.templateId} is not null`),
    uniqueIndex("money_obligations_payment_expense_unique")
      .on(table.paymentExpenseId)
      .where(sql`${table.paymentExpenseId} is not null`),
    index("money_obligations_owner_kind_due_idx").on(
      table.ownerUserId,
      table.kind,
      table.dueDate,
      table.id,
    ),
    index("money_obligations_owner_state_due_idx").on(
      table.ownerUserId,
      table.state,
      table.dueDate,
    ),
    index("money_obligations_owner_template_idx").on(
      table.ownerUserId,
      table.templateId,
    ),
    check(
      "money_obligations_kind_check",
      sql`${table.kind} in ('bill','subscription')`,
    ),
    check(
      "money_obligations_amount_minor_check",
      sql`${table.amountMinor} >= 1 and ${table.amountMinor} <= 2147483647`,
    ),
    check("money_obligations_currency_check", sql`${table.currency} = 'MAD'`),
    check(
      "money_obligations_period_check",
      sql`${table.periodEnd} >= ${table.periodStart} and ${table.dueDate} >= ${table.periodStart} and ${table.dueDate} <= ${table.periodEnd}`,
    ),
    check(
      "money_obligations_purpose_check",
      sql`${table.purpose} in ('fixed','flexible','emergency')`,
    ),
    check(
      "money_obligations_state_check",
      sql`${table.state} in ('pending','paid','waived','cancelled')`,
    ),
    check(
      "money_obligations_paid_requires_evidence_check",
      sql`${table.state} <> 'paid' or ${table.paymentExpenseId} is not null or (${table.paymentEvidence} ->> 'kind' = 'reconciled_historical_import' and btrim(coalesce(${table.paymentEvidence} ->> 'reference', '')) <> '')`,
    ),
    check(
      "money_obligations_unpaid_has_no_payment_check",
      sql`${table.state} = 'paid' or (${table.paymentExpenseId} is null and ${table.paymentEvidence} is null)`,
    ),
  ],
);

/**
 * Canonical daily check-in (PO-05, issue #345). One qualitative record per
 * owner/local date; timer hours and task completion remain in their canonical
 * stores and are derived at read time, never copied here.
 */
export const dailyCheckins = pgTable(
  "daily_checkins",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").default(sql`auth.uid()`).notNull(),
    localDate: date("local_date").notNull(),
    timezone: varchar("timezone", { length: 64 }).notNull(),
    outcomes: varchar("outcomes", { length: 500 }),
    personalMinutes: integer("personal_minutes"),
    notes: varchar("notes", { length: 1000 }),
    overtimeMinutes: integer("overtime_minutes"),
    overtimeReason: varchar("overtime_reason", { length: 300 }),
    routine: jsonb("routine"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("daily_checkins_owner_date_unique").on(
      table.ownerUserId,
      table.localDate,
    ),
    index("daily_checkins_owner_date_idx").on(
      table.ownerUserId,
      table.localDate.desc(),
    ),
    check(
      "daily_checkins_personal_minutes_check",
      sql`${table.personalMinutes} is null or (${table.personalMinutes} >= 0 and ${table.personalMinutes} <= 1440)`,
    ),
    check(
      "daily_checkins_overtime_minutes_check",
      sql`${table.overtimeMinutes} is null or (${table.overtimeMinutes} >= 0 and ${table.overtimeMinutes} <= 1440)`,
    ),
    check(
      "daily_checkins_overtime_reason_check",
      sql`${table.overtimeMinutes} is null or ${table.overtimeMinutes} = 0 or (${table.overtimeReason} is not null and length(btrim(${table.overtimeReason})) > 0)`,
    ),
    check(
      "daily_checkins_routine_check",
      sql`public.valid_routine_metrics(${table.routine})`,
    ),
  ],
);
