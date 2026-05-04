import { sql } from "drizzle-orm";
import {
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
    index("tasks_owner_active_updated_idx")
      .on(table.ownerUserId, table.updatedAt.desc())
      .where(sql`${table.archivedAt} is null`),
    index("tasks_owner_archived_updated_idx")
      .on(table.ownerUserId, table.archivedAt.desc())
      .where(sql`${table.archivedAt} is not null`),
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
  (table) => [index("task_sessions_owner_user_id_idx").on(table.ownerUserId)],
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
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("week_reviews_owner_user_id_idx").on(table.ownerUserId),
    uniqueIndex("week_reviews_owner_user_id_week_start_unique").on(
      table.ownerUserId,
      table.weekStart,
    ),
  ],
);
