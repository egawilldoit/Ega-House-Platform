type ReminderDeliverySupabaseClient = {
  from(table: "task_reminders"): {
    select(columns: string): ReminderSelectQuery;
    update(payload: Record<string, unknown>): ReminderUpdateQuery;
  };
};

type ReminderSelectQuery = {
  eq(column: string, value: string): ReminderSelectQuery;
  lte(column: string, value: string): ReminderSelectQuery;
  order(column: string, options?: { ascending?: boolean }): ReminderSelectQuery;
  limit(count: number): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
};

type ReminderUpdateQuery = {
  eq(column: string, value: string): ReminderUpdateQuery;
  select(columns: string): {
    maybeSingle(): PromiseLike<{ data: unknown | null; error: { message: string } | null }>;
  };
};

type ResendEmailClient = {
  emails: {
    send(input: {
      from: string;
      to: string;
      subject: string;
      html: string;
    }): Promise<{ data?: { id?: string } | null; error?: unknown }>;
  };
};

type ReminderTaskRow = {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
  planned_for_date: string | null;
  projects: { name: string | null; slug: string | null } | null;
};

type ReminderDeliveryRow = {
  id: string;
  task_id: string;
  remind_at: string;
  channel: string;
  status: string;
  sent_at: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
  tasks: ReminderTaskRow | ReminderTaskRow[] | null;
};

export type TaskReminderDeliveryCounts = {
  due: number;
  claimed: number;
  sent: number;
  failed: number;
  skipped: number;
};

export type DeliverTaskReminderEmailsOptions = {
  supabase: ReminderDeliverySupabaseClient;
  resend: ResendEmailClient;
  from: string;
  to: string;
  ownerUserId?: string;
  now?: Date;
  limit?: number;
  appUrl?: string;
};

const DEFAULT_APP_URL = "https://www.egawilldoit.online";
const DEFAULT_LIMIT = 25;
const REMINDER_SELECT =
  "id, task_id, remind_at, channel, status, sent_at, failure_reason, created_at, updated_at, tasks(id, title, status, priority, due_date, planned_for_date, projects(name, slug))";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeAppUrl(value: string | undefined) {
  return (value ?? process.env.APP_URL ?? DEFAULT_APP_URL).replace(/\/+$/, "");
}

function singleTask(value: ReminderDeliveryRow["tasks"]) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function formatDateOnly(value: string | null) {
  return value?.trim() || "None";
}

function formatReminderInstant(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toISOString().replace(".000Z", "Z");
}

function taskHref(task: ReminderTaskRow | null, taskId: string, appUrl: string) {
  const slug = task?.projects?.slug?.trim();
  const path = slug ? `/tasks/projects/${encodeURIComponent(slug)}` : "/tasks";

  return `${appUrl}${path}#task-${encodeURIComponent(taskId)}`;
}

function summarizeError(error: unknown) {
  if (!error) {
    return "Unknown reminder email delivery error.";
  }

  if (error instanceof Error) {
    return error.message.slice(0, 500);
  }

  if (typeof error === "string") {
    return error.slice(0, 500);
  }

  try {
    return JSON.stringify(error).slice(0, 500);
  } catch {
    return "Unknown reminder email delivery error.";
  }
}

export function buildTaskReminderEmail(reminder: ReminderDeliveryRow, appUrl = normalizeAppUrl(undefined)) {
  const task = singleTask(reminder.tasks);
  const taskTitle = task?.title?.trim() || "Untitled task";
  const projectName = task?.projects?.name?.trim() || "No project";
  const directUrl = taskHref(task, reminder.task_id, appUrl);
  const rows = [
    ["Project", projectName],
    ["Due", formatDateOnly(task?.due_date ?? null)],
    ["Planned", formatDateOnly(task?.planned_for_date ?? null)],
    ["Priority", task?.priority ?? "None"],
    ["Reminder", formatReminderInstant(reminder.remind_at)],
  ];

  return {
    subject: `Task reminder: ${taskTitle}`,
    html: `
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f6f8f3;padding:24px;">
        <tr>
          <td>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #dfe8db;border-radius:12px;">
              <tr>
                <td style="padding:22px;">
                  <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:16px;text-transform:uppercase;color:#607060;font-weight:700;">EGA task reminder</div>
                  <h1 style="font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:28px;margin:8px 0 16px;color:#182016;">${escapeHtml(taskTitle)}</h1>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                    ${rows
                      .map(
                        ([label, value]) => `
                          <tr>
                            <td style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#607060;font-weight:700;padding:0 12px 8px 0;width:88px;">${escapeHtml(label)}</td>
                            <td style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#182016;padding:0 0 8px 0;">${escapeHtml(value)}</td>
                          </tr>
                        `,
                      )
                      .join("")}
                  </table>
                  <div style="padding-top:12px;">
                    <a href="${escapeHtml(directUrl)}" style="font-family:Arial,Helvetica,sans-serif;display:inline-block;background:#047857;color:#ffffff;text-decoration:none;border-radius:8px;padding:10px 14px;font-size:14px;line-height:20px;font-weight:700;">Open task</a>
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    `,
  };
}

async function claimReminder(
  supabase: ReminderDeliverySupabaseClient,
  reminderId: string,
  nowIso: string,
) {
  const { data, error } = await supabase
    .from("task_reminders")
    .update({
      status: "processing",
      failure_reason: null,
      updated_at: nowIso,
    })
    .eq("id", reminderId)
    .eq("status", "pending")
    .eq("channel", "email")
    .select(REMINDER_SELECT)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to claim task reminder: ${error.message}`);
  }

  return (data ?? null) as ReminderDeliveryRow | null;
}

async function markReminder(
  supabase: ReminderDeliverySupabaseClient,
  reminderId: string,
  payload: Record<string, unknown>,
) {
  const { error } = await supabase
    .from("task_reminders")
    .update(payload)
    .eq("id", reminderId)
    .eq("status", "processing")
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update task reminder delivery status: ${error.message}`);
  }
}

export async function deliverTaskReminderEmails(options: DeliverTaskReminderEmailsOptions) {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const appUrl = normalizeAppUrl(options.appUrl);
  const limit = options.limit ?? DEFAULT_LIMIT;
  const counts: TaskReminderDeliveryCounts = {
    due: 0,
    claimed: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
  };

  let query = options.supabase
    .from("task_reminders")
    .select(REMINDER_SELECT)
    .eq("status", "pending")
    .eq("channel", "email");

  if (options.ownerUserId) {
    query = query.eq("owner_user_id", options.ownerUserId);
  }

  const { data, error } = await query
    .lte("remind_at", nowIso)
    .order("remind_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to load due task reminders: ${error.message}`);
  }

  const reminders = ((data ?? []) as ReminderDeliveryRow[]).filter((reminder) => {
    const shouldSend = reminder.status === "pending" && reminder.channel === "email";

    if (!shouldSend) {
      counts.skipped += 1;
    }

    return shouldSend;
  });
  counts.due = reminders.length;

  for (const reminder of reminders) {
    const claimedReminder = await claimReminder(options.supabase, reminder.id, nowIso);

    if (!claimedReminder) {
      counts.skipped += 1;
      continue;
    }

    counts.claimed += 1;

    const email = buildTaskReminderEmail(claimedReminder, appUrl);
    let sendError: unknown = null;

    try {
      const sendResult = await options.resend.emails.send({
        from: options.from,
        to: options.to,
        subject: email.subject,
        html: email.html,
      });
      sendError = sendResult.error ?? null;
    } catch (error) {
      sendError = error;
    }

    if (sendError) {
      counts.failed += 1;
      await markReminder(options.supabase, claimedReminder.id, {
        status: "failed",
        failure_reason: summarizeError(sendError),
        updated_at: nowIso,
      });
      continue;
    }

    counts.sent += 1;
    await markReminder(options.supabase, claimedReminder.id, {
      status: "sent",
      sent_at: nowIso,
      failure_reason: null,
      updated_at: nowIso,
    });
  }

  return { ok: true as const, counts };
}
