export const DAILY_ASSISTANT_EMAIL_TYPES = [
  "morning",
  "midday",
  "afternoon",
  "night-review",
  "weekly-review",
] as const;

export type DailyAssistantEmailType = (typeof DAILY_ASSISTANT_EMAIL_TYPES)[number];

type DailyAssistantSection = {
  title: string;
  body: string;
};

type DailyAssistantTemplate = {
  subject: string;
  title: string;
  intro: string;
  sections: DailyAssistantSection[];
  ctaLabel: string;
  ctaHref: string;
};

const APP_URL = "https://www.egawilldoit.online";
const NO_TASK_DATA = "No task data was found for this period yet.";
const NO_TIMER_DATA = "No timer data was found for this period yet.";
const NO_REVIEW_DATA = "No review data was found for this period yet.";

const DAILY_ASSISTANT_TEMPLATES: Record<DailyAssistantEmailType, DailyAssistantTemplate> = {
  morning: {
    subject: "EGA Morning Plan",
    title: "EGA Morning Plan",
    intro: "Good morning. Start with a clear plan for the work that matters today.",
    sections: [
      {
        title: "Today Focus",
        body: "Choose the most important outcome before starting the first timer.",
      },
      {
        title: "Today Tasks",
        body: NO_TASK_DATA,
      },
      {
        title: "Due Today",
        body: NO_TASK_DATA,
      },
    ],
    ctaLabel: "Open EGA Tasks",
    ctaHref: `${APP_URL}/tasks`,
  },
  midday: {
    subject: "EGA Midday Check-in",
    title: "EGA Midday Check-in",
    intro: "Pause briefly, check the work already done, and pick the next useful action.",
    sections: [
      {
        title: "Tasks Progress",
        body: NO_TASK_DATA,
      },
      {
        title: "Time Worked Today",
        body: NO_TIMER_DATA,
      },
      {
        title: "Next Action",
        body: "Start one focused timer on the next task that moves the day forward.",
      },
    ],
    ctaLabel: "Open EGA Timer",
    ctaHref: `${APP_URL}/timer`,
  },
  afternoon: {
    subject: "EGA Afternoon Progress",
    title: "EGA Afternoon Progress",
    intro: "Use the afternoon check to protect momentum and avoid leaving the day vague.",
    sections: [
      {
        title: "Work Progress",
        body: NO_TASK_DATA,
      },
      {
        title: "Remaining Tasks",
        body: NO_TASK_DATA,
      },
      {
        title: "Small Finish",
        body: "Finish one small thing before switching contexts.",
      },
    ],
    ctaLabel: "Open EGA Dashboard",
    ctaHref: `${APP_URL}/dashboard`,
  },
  "night-review": {
    subject: "EGA Day Review",
    title: "EGA Day Review",
    intro: "Close the day by capturing what happened and making tomorrow easier to start.",
    sections: [
      {
        title: "Completed Today",
        body: NO_TASK_DATA,
      },
      {
        title: "Time Worked Today",
        body: NO_TIMER_DATA,
      },
      {
        title: "Unfinished Tasks",
        body: NO_TASK_DATA,
      },
      {
        title: "Plan Tomorrow",
        body: "Review today, then choose the first useful task for tomorrow.",
      },
    ],
    ctaLabel: "Open EGA Review",
    ctaHref: `${APP_URL}/review`,
  },
  "weekly-review": {
    subject: "EGA Weekly Review",
    title: "EGA Weekly Review",
    intro: "Review the week before planning the next one.",
    sections: [
      {
        title: "Total Hours This Week",
        body: NO_TIMER_DATA,
      },
      {
        title: "Work Summary",
        body: NO_REVIEW_DATA,
      },
      {
        title: "Tasks Completed",
        body: NO_TASK_DATA,
      },
      {
        title: "Goals and Projects Progress",
        body: NO_TASK_DATA,
      },
      {
        title: "Next Week Priorities",
        body: "Pick the few priorities that should shape next week's execution loop.",
      },
    ],
    ctaLabel: "Open EGA Review",
    ctaHref: `${APP_URL}/review`,
  },
};

export function isDailyAssistantEmailType(value: string): value is DailyAssistantEmailType {
  return DAILY_ASSISTANT_EMAIL_TYPES.includes(value as DailyAssistantEmailType);
}

export function buildDailyAssistantEmail(type: DailyAssistantEmailType) {
  const template = DAILY_ASSISTANT_TEMPLATES[type];

  return {
    subject: template.subject,
    html: renderDailyAssistantHtml(template),
  };
}

function renderDailyAssistantHtml(template: DailyAssistantTemplate) {
  const sections = template.sections
    .map(
      (section) => `
        <div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:0 0 12px 0;background:#ffffff;">
          <h2 style="font-size:16px;line-height:22px;margin:0 0 8px 0;color:#111827;">${section.title}</h2>
          <p style="font-size:14px;line-height:22px;margin:0;color:#374151;">${section.body}</p>
        </div>
      `,
    )
    .join("");

  return `
    <div style="margin:0;padding:0;background:#f6f7f9;font-family:Arial,Helvetica,sans-serif;color:#111827;">
      <div style="max-width:640px;margin:0 auto;padding:32px 20px;">
        <h1 style="font-size:28px;line-height:34px;margin:0 0 10px 0;color:#111827;">${template.title}</h1>
        <p style="font-size:15px;line-height:24px;margin:0 0 20px 0;color:#4b5563;">${template.intro}</p>
        ${sections}
        <div style="margin:24px 0;">
          <a href="${template.ctaHref}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;border-radius:8px;padding:12px 18px;font-size:14px;font-weight:700;">${template.ctaLabel}</a>
        </div>
        <p style="font-size:12px;line-height:18px;margin:24px 0 0 0;color:#6b7280;">Sent by EGA House</p>
      </div>
    </div>
  `;
}
