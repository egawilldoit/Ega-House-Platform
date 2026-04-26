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

type DailyAssistantTemplate = {
  subject: string;
  title: string;
  intro: string;
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
    item.projectName,
    item.goalTitle,
  ]
    .filter(Boolean)
    .join(" | ");
}

function taskItems(tasks: AssistantEmailData["tasks"]["open"]): ListItem[] {
  return tasks.map((task) => ({
    title: task.title,
    meta: formatTaskMeta(task),
  }));
}

function sessionItems(sessions: AssistantEmailData["time"]["sessionsThisWeek"]): ListItem[] {
  return sessions.map((session) => ({
    title: session.taskTitle,
    meta: [formatDuration(session.durationSeconds), session.projectName, session.goalTitle]
      .filter(Boolean)
      .join(" | "),
  }));
}

function simpleItems(items: Array<{ name?: string; title?: string; status?: string; projectName?: string | null }>) {
  return items.map((item) => ({
    title: item.title ?? item.name ?? "Untitled",
    meta: [item.status, item.projectName].filter(Boolean).join(" | "),
  }));
}

function renderList(items: ListItem[], emptyText: string) {
  if (items.length === 0) {
    return `<p style="font-size:14px;line-height:22px;margin:0;color:#6b7280;">${escapeHtml(emptyText)}</p>`;
  }

  const listItems = items
    .map(
      (item) => `
        <li style="margin:0 0 10px 0;">
          <div style="font-size:14px;line-height:20px;color:#111827;font-weight:700;">${escapeHtml(item.title)}</div>
          ${
            item.meta
              ? `<div style="font-size:12px;line-height:18px;color:#6b7280;">${escapeHtml(item.meta)}</div>`
              : ""
          }
        </li>
      `,
    )
    .join("");

  return `<ul style="padding:0 0 0 18px;margin:0;">${listItems}</ul>`;
}

function renderStat(label: string, value: string) {
  return `
    <div style="font-size:14px;line-height:22px;color:#374151;">
      <strong style="color:#111827;">${escapeHtml(label)}:</strong> ${escapeHtml(value)}
    </div>
  `;
}

function getDailyAssistantTemplate(data: AssistantEmailData): DailyAssistantTemplate {
  const appUrl = getAppUrl();

  switch (data.type) {
    case "morning":
      return {
        subject: "EGA Morning Plan",
        title: "EGA Morning Plan",
        intro: "Good morning. Start with the work that matters today.",
        sections: [
          {
            title: "Today's Due Tasks",
            html: renderList(taskItems(data.tasks.dueToday), EMPTY_TASKS),
          },
          {
            title: "Open Tasks / Focus Candidates",
            html: renderList(taskItems(data.tasks.open), EMPTY_TASKS),
          },
          {
            title: "Overdue Tasks",
            html: renderList(taskItems(data.tasks.overdue), EMPTY_TASKS),
          },
        ],
        ctaLabel: "Open EGA Tasks",
        ctaHref: `${appUrl}/tasks`,
      };
    case "midday":
      return {
        subject: "EGA Midday Check-in",
        title: "EGA Midday Check-in",
        intro: "Check progress, then pick the next focused action.",
        sections: [
          {
            title: "Today Task Progress",
            html: [
              renderStat("Completed today", String(data.tasks.completedToday.length)),
              renderStat("Open focus candidates", String(data.tasks.open.length)),
            ].join(""),
          },
          {
            title: "Time Worked Today",
            html:
              data.time.todayTotalSeconds > 0
                ? renderStat("Tracked time", formatDuration(data.time.todayTotalSeconds))
                : renderList([], EMPTY_TIME),
          },
          {
            title: "Current Remaining Tasks",
            html: renderList(taskItems(data.tasks.open), EMPTY_TASKS),
          },
        ],
        ctaLabel: "Open EGA Timer",
        ctaHref: `${appUrl}/timer`,
      };
    case "afternoon":
      return {
        subject: "EGA Afternoon Progress",
        title: "EGA Afternoon Progress",
        intro: "Protect momentum and make the afternoon count.",
        sections: [
          {
            title: "Time Worked Today",
            html:
              data.time.todayTotalSeconds > 0
                ? renderStat("Tracked time", formatDuration(data.time.todayTotalSeconds))
                : renderList([], EMPTY_TIME),
          },
          {
            title: "Completed Today",
            html: renderList(taskItems(data.tasks.completedToday), EMPTY_COMPLETED),
          },
          {
            title: "Remaining / Overdue Tasks",
            html: renderList(taskItems([...data.tasks.overdue, ...data.tasks.open].slice(0, 10)), EMPTY_TASKS),
          },
          {
            title: "Small Finish",
            html: `<p style="font-size:14px;line-height:22px;margin:0;color:#374151;">Finish one small task before switching contexts.</p>`,
          },
        ],
        ctaLabel: "Open EGA Dashboard",
        ctaHref: `${appUrl}/dashboard`,
      };
    case "night-review":
      return {
        subject: "EGA Day Review",
        title: "EGA Day Review",
        intro: "Close the day by capturing what happened and making tomorrow easier to start.",
        sections: [
          {
            title: "Completed Today",
            html: renderList(taskItems(data.tasks.completedToday), EMPTY_COMPLETED),
          },
          {
            title: "Time Worked Today",
            html:
              data.time.todayTotalSeconds > 0
                ? renderStat("Tracked time", formatDuration(data.time.todayTotalSeconds))
                : renderList([], EMPTY_TIME),
          },
          {
            title: "Unfinished Tasks",
            html: renderList(taskItems(data.tasks.open), EMPTY_TASKS),
          },
          {
            title: "Plan Tomorrow",
            html: `<p style="font-size:14px;line-height:22px;margin:0;color:#374151;">Review today, then choose the first useful task for tomorrow.</p>`,
          },
        ],
        ctaLabel: "Open EGA Review",
        ctaHref: `${appUrl}/review`,
      };
    case "weekly-review":
      return {
        subject: "EGA Weekly Review",
        title: "EGA Weekly Review",
        intro: "Review the week before planning the next one.",
        sections: [
          {
            title: "Total Hours This Week",
            html:
              data.time.weekTotalSeconds > 0
                ? renderStat("Tracked time", formatDuration(data.time.weekTotalSeconds))
                : renderList([], EMPTY_TIME),
          },
          {
            title: "Sessions This Week",
            html: renderList(sessionItems(data.time.sessionsThisWeek), EMPTY_TIME),
          },
          {
            title: "Completed Tasks This Week",
            html: renderList(taskItems(data.tasks.completedThisWeek), EMPTY_COMPLETED),
          },
          {
            title: "Projects / Goals Touched",
            html: [
              renderList(simpleItems(data.projects.touchedThisWeek), "No projects found for this period yet."),
              data.goals.progressedThisWeek.length > 0
                ? `<div style="height:12px;"></div>${renderList(simpleItems(data.goals.progressedThisWeek), EMPTY_TASKS)}`
                : "",
            ].join(""),
          },
          {
            title: "Next Week Priorities",
            html: `<p style="font-size:14px;line-height:22px;margin:0;color:#374151;">Pick the few priorities that should shape next week's Project -> Goal -> Task -> Timer -> Review loop.</p>`,
          },
        ],
        ctaLabel: "Open EGA Review",
        ctaHref: `${appUrl}/review`,
      };
  }
}

function renderDailyAssistantHtml(template: DailyAssistantTemplate) {
  const sections = template.sections
    .map(
      (section) => `
        <div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:0 0 12px 0;background:#ffffff;">
          <h2 style="font-size:16px;line-height:22px;margin:0 0 8px 0;color:#111827;">${escapeHtml(section.title)}</h2>
          ${section.html}
        </div>
      `,
    )
    .join("");

  return `
    <div style="margin:0;padding:0;background:#f6f7f9;font-family:Arial,Helvetica,sans-serif;color:#111827;">
      <div style="max-width:640px;margin:0 auto;padding:32px 20px;">
        <h1 style="font-size:28px;line-height:34px;margin:0 0 10px 0;color:#111827;">${escapeHtml(template.title)}</h1>
        <p style="font-size:15px;line-height:24px;margin:0 0 20px 0;color:#4b5563;">${escapeHtml(template.intro)}</p>
        ${sections}
        <div style="margin:24px 0;">
          <a href="${escapeHtml(template.ctaHref)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;border-radius:8px;padding:12px 18px;font-size:14px;font-weight:700;">${escapeHtml(template.ctaLabel)}</a>
        </div>
        <p style="font-size:12px;line-height:18px;margin:24px 0 0 0;color:#6b7280;">Sent by EGA House</p>
      </div>
    </div>
  `;
}
