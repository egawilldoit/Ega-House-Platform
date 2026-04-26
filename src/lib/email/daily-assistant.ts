import type { AssistantEmailData, AssistantEmailType } from "@/lib/email/assistant-data";

export const DAILY_ASSISTANT_EMAIL_TYPES = [
  "morning",
  "midday",
  "afternoon",
  "night-review",
  "weekly-review",
] as const satisfies AssistantEmailType[];

export type DailyAssistantEmailType = (typeof DAILY_ASSISTANT_EMAIL_TYPES)[number];

type DailyAssistantSection = {
  title: string;
  html: string;
};

type DailyAssistantStat = {
  label: string;
  value: string;
};

type DailyAssistantTemplate = {
  subject: string;
  preheader: string;
  label: string;
  title: string;
  intro: string;
  stats: DailyAssistantStat[];
  sections: DailyAssistantSection[];
  ctaLabel: string;
  ctaHref: string;
};

type ListItem = {
  title: string;
  meta?: string;
};

const DEFAULT_APP_URL = "https://www.egawilldoit.online";
const EMPTY_TASKS = "No tasks found for this period yet.";
const EMPTY_TIME = "No tracked time found yet.";
const EMPTY_COMPLETED = "No completed tasks found yet.";
const EMPTY_ACTIVE_GOALS = "No active goals found yet.";
const MAX_LIST_ITEMS = 5;

export function isDailyAssistantEmailType(value: string): value is DailyAssistantEmailType {
  return DAILY_ASSISTANT_EMAIL_TYPES.includes(value as DailyAssistantEmailType);
}

export function buildDailyAssistantEmail(data: AssistantEmailData) {
  const template = getDailyAssistantTemplate(data);

  return {
    subject: template.subject,
    html: renderDailyAssistantHtml(template),
  };
}

function getAppUrl() {
  return (process.env.APP_URL ?? DEFAULT_APP_URL).replace(/\/+$/, "");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function truncate(value: string, maxLength = 96) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}...`;
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

function formatTaskMeta(item: {
  status?: string;
  dueDate?: string | null;
  projectName?: string | null;
  goalTitle?: string | null;
}) {
  return [
    item.status ? item.status.replaceAll("_", " ") : null,
    item.dueDate ? `Due ${item.dueDate}` : null,
    item.projectName ? truncate(item.projectName, 42) : null,
    item.goalTitle ? truncate(item.goalTitle, 42) : null,
  ]
    .filter(Boolean)
    .join(" | ");
}

function taskItems(tasks: AssistantEmailData["tasks"]["open"]): ListItem[] {
  return tasks.map((task) => ({
    title: truncate(task.title),
    meta: formatTaskMeta(task),
  }));
}

function simpleItems(
  items: Array<{ name?: string; title?: string; status?: string; projectName?: string | null }>,
): ListItem[] {
  return items.map((item) => ({
    title: truncate(item.title ?? item.name ?? "Untitled"),
    meta: [item.status, item.projectName ? truncate(item.projectName, 42) : null]
      .filter(Boolean)
      .join(" | "),
  }));
}

function renderList(items: ListItem[], emptyText: string) {
  if (items.length === 0) {
    return `<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;margin:0;color:#607060;">${escapeHtml(emptyText)}</p>`;
  }

  const visibleItems = items.slice(0, MAX_LIST_ITEMS);
  const remainingCount = Math.max(0, items.length - visibleItems.length);
  const rows = visibleItems
    .map(
      (item) => `
        <tr>
          <td style="padding:0 0 12px 0;">
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:21px;color:#182016;font-weight:700;">${escapeHtml(item.title)}</div>
            ${
              item.meta
                ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#607060;padding-top:2px;">${escapeHtml(item.meta)}</div>`
                : ""
            }
          </td>
        </tr>
      `,
    )
    .join("");

  const moreRow =
    remainingCount > 0
      ? `
        <tr>
          <td style="padding:0;">
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:19px;color:#047857;font-weight:700;">+ ${remainingCount} more</div>
          </td>
        </tr>
      `
      : "";

  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${rows}${moreRow}</table>`;
}

function renderParagraph(value: string) {
  return `<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;margin:0;color:#374433;">${escapeHtml(value)}</p>`;
}

function renderSummaryText(value: string | null | undefined, emptyText: string) {
  const normalized = value?.trim();

  if (!normalized) {
    return renderParagraph(emptyText);
  }

  return renderParagraph(truncate(normalized, 220));
}

function renderStats(stats: DailyAssistantStat[]) {
  const cells = stats
    .map(
      (stat) => `
        <td width="${Math.floor(100 / stats.length)}%" style="padding:0 6px 12px 6px;vertical-align:top;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#fbfdf9;border:1px solid #dfe8db;border-radius:10px;">
            <tr>
              <td style="padding:14px 12px;">
                <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:15px;text-transform:uppercase;letter-spacing:0;color:#607060;font-weight:700;">${escapeHtml(stat.label)}</div>
                <div style="font-family:Arial,Helvetica,sans-serif;font-size:20px;line-height:26px;color:#182016;font-weight:700;padding-top:4px;">${escapeHtml(stat.value)}</div>
              </td>
            </tr>
          </table>
        </td>
      `,
    )
    .join("");

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 8px 0;">
      <tr>${cells}</tr>
    </table>
  `;
}

function renderSection(section: DailyAssistantSection) {
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#ffffff;border:1px solid #dfe8db;border-radius:12px;margin:0 0 12px 0;">
      <tr>
        <td style="padding:18px;">
          <h2 style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:22px;margin:0 0 12px 0;color:#182016;">${escapeHtml(section.title)}</h2>
          ${section.html}
        </td>
      </tr>
    </table>
  `;
}

function getDailyAssistantTemplate(data: AssistantEmailData): DailyAssistantTemplate {
  const appUrl = getAppUrl();

  switch (data.type) {
    case "morning": {
      const sections: DailyAssistantSection[] = [
        {
          title: "Due today",
          html: renderList(taskItems(data.tasks.dueToday), EMPTY_TASKS),
        },
        {
          title: "Focus candidates",
          html: renderList(taskItems(data.tasks.open), EMPTY_TASKS),
        },
      ];

      if (data.tasks.overdue.length > 0) {
        sections.push({
          title: "Overdue",
          html: renderList(taskItems(data.tasks.overdue), EMPTY_TASKS),
        });
      }

      return {
        subject: "EGA Morning Plan",
        preheader: "Your tasks, due items, and focus candidates for today.",
        label: "Morning plan",
        title: "Good morning — here is today's plan",
        intro: `You have ${pluralize(data.tasks.dueToday.length, "task")} due today and ${pluralize(data.tasks.open.length, "open task")}. Start with one focused timer before the day gets noisy.`,
        stats: [
          { label: "Due today", value: String(data.tasks.dueToday.length) },
          { label: "Open tasks", value: String(data.tasks.open.length) },
          { label: "Time today", value: formatDuration(data.time.todayTotalSeconds) },
        ],
        sections,
        ctaLabel: "Open Tasks",
        ctaHref: `${appUrl}/tasks`,
      };
    }
    case "midday":
      return {
        subject: "EGA Midday Check-in",
        preheader: "Quick progress check for tasks and focus time.",
        label: "Midday check-in",
        title: "Midday check-in",
        intro:
          data.time.todayTotalSeconds > 0
            ? `You have ${formatDuration(data.time.todayTotalSeconds)} logged today. Use the next block to close or advance one visible task.`
            : "No focus time is logged yet today. Pick one task and start a clean timer block.",
        stats: [
          { label: "Time today", value: formatDuration(data.time.todayTotalSeconds) },
          { label: "Sessions", value: String(data.time.sessionsToday.length) },
          { label: "Open tasks", value: String(data.tasks.open.length) },
        ],
        sections: [
          {
            title: "Progress so far",
            html:
              data.tasks.completedToday.length > 0
                ? renderList(taskItems(data.tasks.completedToday), EMPTY_COMPLETED)
                : renderParagraph(
                    "No completed tasks yet. Choose one small task to close before the next check-in.",
                  ),
          },
          {
            title: "Remaining focus",
            html: renderList(taskItems(data.tasks.open), EMPTY_TASKS),
          },
          {
            title: "Suggested next action",
            html: renderParagraph("Start a timer on the smallest task that would make the day feel less open."),
          },
        ],
        ctaLabel: "Open Timer",
        ctaHref: `${appUrl}/timer`,
      };
    case "afternoon":
      return {
        subject: "EGA Afternoon Progress",
        preheader: "Where the day stands and what to finish next.",
        label: "Afternoon progress",
        title: "Afternoon progress update",
        intro:
          data.tasks.completedToday.length > 0
            ? `${pluralize(data.tasks.completedToday.length, "task")} completed today. Use the afternoon to finish one more contained piece.`
            : "Nothing is marked complete yet. The best next move is one small finish, not a broad reset.",
        stats: [
          { label: "Time today", value: formatDuration(data.time.todayTotalSeconds) },
          { label: "Completed", value: String(data.tasks.completedToday.length) },
          { label: "Projects", value: String(data.projects.touchedToday.length) },
        ],
        sections: [
          {
            title: "Completed today",
            html: renderList(taskItems(data.tasks.completedToday), EMPTY_COMPLETED),
          },
          {
            title: "Still open",
            html: renderList(taskItems([...data.tasks.overdue, ...data.tasks.open]), EMPTY_TASKS),
          },
          {
            title: "One small finish recommendation",
            html: renderParagraph("Pick a task that can be closed in one focused session and finish it before switching contexts."),
          },
        ],
        ctaLabel: "Open Dashboard",
        ctaHref: `${appUrl}/dashboard`,
      };
    case "night-review":
      return {
        subject: "EGA Day Review",
        preheader: "Review today and prepare tomorrow.",
        label: "Day review",
        title: "Day review",
        intro:
          data.tasks.completedToday.length > 0
            ? `${pluralize(data.tasks.completedToday.length, "task")} completed and ${formatDuration(data.time.todayTotalSeconds)} tracked today. Capture the handoff while it is still fresh.`
            : `You tracked ${formatDuration(data.time.todayTotalSeconds)} today. Review what happened and choose tomorrow's first useful task.`,
        stats: [
          { label: "Time today", value: formatDuration(data.time.todayTotalSeconds) },
          { label: "Completed", value: String(data.tasks.completedToday.length) },
          { label: "Open tasks", value: String(data.tasks.open.length) },
        ],
        sections: [
          {
            title: "What got done",
            html: renderList(taskItems(data.tasks.completedToday), EMPTY_COMPLETED),
          },
          {
            title: "Unfinished work",
            html: renderList(taskItems(data.tasks.open), EMPTY_TASKS),
          },
          {
            title: "Plan tomorrow",
            html: renderParagraph("Choose the first task for tomorrow and leave a clear review note before closing the day."),
          },
        ],
        ctaLabel: "Open Review",
        ctaHref: `${appUrl}/review`,
      };
    case "weekly-review":
      return {
        subject: "EGA Weekly Review",
        preheader: "Your weekly work summary, hours, projects, and next-week planning.",
        label: "Weekly review",
        title: "Weekly review",
        intro: `${formatDuration(data.time.weekTotalSeconds)} tracked across ${pluralize(data.time.sessionsThisWeek.length, "session")} this week. Review the pattern before choosing next week's priorities.`,
        stats: [
          { label: "Hours", value: formatDuration(data.time.weekTotalSeconds) },
          { label: "Sessions", value: String(data.time.sessionsThisWeek.length) },
          { label: "Projects", value: String(data.projects.touchedThisWeek.length) },
          { label: "Completed", value: String(data.tasks.completedThisWeek.length) },
        ],
        sections: [
          {
            title: "Work summary",
            html: renderSummaryText(
              data.review.latestWeeklyReview?.summary,
              data.time.sessionsThisWeek.length > 0
                ? `${pluralize(data.time.sessionsThisWeek.length, "session")} logged this week. Open review to write the summary.`
                : EMPTY_TIME,
            ),
          },
          {
            title: "Projects touched",
            html: renderList(
              simpleItems(data.projects.touchedThisWeek),
              "No projects found for this period yet.",
            ),
          },
          {
            title: "Active goals",
            html: renderList(simpleItems(data.goals.active), EMPTY_ACTIVE_GOALS),
          },
          {
            title: "Next week planning",
            html: renderParagraph("Pick the few priorities that should shape next week's Project -> Goal -> Task -> Timer -> Review loop."),
          },
        ],
        ctaLabel: "Open Review",
        ctaHref: `${appUrl}/review`,
      };
  }
}

function renderDailyAssistantHtml(template: DailyAssistantTemplate) {
  const sections = template.sections.map(renderSection).join("");

  return `<!doctype html>
<html>
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(template.subject)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f7f2;color:#182016;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;">${escapeHtml(template.preheader)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f7f2;margin:0;padding:0;">
      <tr>
        <td align="center" style="padding:28px 12px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:660px;background:#fbfdf9;border:1px solid #dfe8db;border-radius:16px;">
            <tr>
              <td style="padding:28px 24px 10px 24px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#15803d;font-weight:700;">EGA House</td>
                  </tr>
                  <tr>
                    <td style="padding-top:14px;">
                      <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:16px;color:#047857;font-weight:700;text-transform:uppercase;letter-spacing:0;">${escapeHtml(template.label)}</div>
                      <h1 style="font-family:Arial,Helvetica,sans-serif;font-size:28px;line-height:34px;margin:8px 0 10px 0;color:#182016;font-weight:700;">${escapeHtml(template.title)}</h1>
                      <p style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;margin:0;color:#607060;">${escapeHtml(template.intro)}</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:10px 18px 0 18px;">
                ${renderStats(template.stats)}
              </td>
            </tr>
            <tr>
              <td style="padding:0 24px 6px 24px;">
                ${sections}
              </td>
            </tr>
            <tr>
              <td align="left" style="padding:8px 24px 30px 24px;">
                <a href="${escapeHtml(template.ctaHref)}" style="display:inline-block;background:#15803d;color:#ffffff;text-decoration:none;border-radius:10px;padding:15px 22px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:20px;font-weight:700;">${escapeHtml(template.ctaLabel)}</a>
              </td>
            </tr>
            <tr>
              <td style="border-top:1px solid #dfe8db;padding:16px 24px 22px 24px;">
                <p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;margin:0;color:#607060;">Sent by EGA House</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
