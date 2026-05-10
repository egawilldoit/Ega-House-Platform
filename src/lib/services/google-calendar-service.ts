import {
  DEFAULT_CALENDAR_REMINDER_MINUTES,
  GOOGLE_CALENDAR_PROVIDER,
  MAX_CALENDAR_REMINDER_MINUTES,
  normalizeCalendarReminderMinutes,
} from "@/lib/services/calendar-settings-service";

export type GoogleCalendarCredentialSnapshot = {
  provider: string;
  google_account_email: string | null;
  scheduled_task_sync_enabled: boolean | null;
  default_reminder_minutes: number | null;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
  token_expires_at: string | null;
  connected_at: string | null;
  disconnected_at: string | null;
};

export type GoogleCalendarEventCreateInput = {
  calendarId: "primary";
  summary: string;
  start: { dateTime: string };
  end: { dateTime: string };
  reminders: {
    useDefault: false;
    overrides: Array<{ method: "popup"; minutes: number }>;
  };
};

export type GoogleCalendarEventCreateResult =
  | { eventId: string; errorMessage: null }
  | { eventId: null; errorMessage: string };

export type GoogleCalendarClient = {
  createEvent(
    input: GoogleCalendarEventCreateInput,
    credentials: GoogleCalendarCredentialSnapshot,
  ): Promise<GoogleCalendarEventCreateResult>;
};

export type CalendarTaskEventInput = {
  taskId: string;
  title: string;
  scheduledStartAt: string | null | undefined;
  scheduledEndAt: string | null | undefined;
  calendarSyncEnabled: boolean | null | undefined;
  calendarReminderMinutes: number | null | undefined;
};

export type CalendarTaskEventResult =
  | { status: "synced"; eventId: string; failureReason: null }
  | { status: "skipped"; eventId: null; failureReason: string | null }
  | { status: "failed"; eventId: null; failureReason: string };

function isConnectedGoogleCalendar(
  credentials: GoogleCalendarCredentialSnapshot | null,
) {
  return Boolean(
    credentials &&
      credentials.provider === GOOGLE_CALENDAR_PROVIDER &&
      credentials.connected_at &&
      !credentials.disconnected_at &&
      (credentials.access_token_encrypted || credentials.refresh_token_encrypted),
  );
}

function hasScheduledWindow(task: CalendarTaskEventInput) {
  return Boolean(task.scheduledStartAt && task.scheduledEndAt);
}

function getReminderMinutes(
  task: CalendarTaskEventInput,
  credentials: GoogleCalendarCredentialSnapshot,
) {
  const rawReminder =
    task.calendarReminderMinutes ?? credentials.default_reminder_minutes;
  const reminderMinutes = normalizeCalendarReminderMinutes(rawReminder);

  if (reminderMinutes > MAX_CALENDAR_REMINDER_MINUTES) {
    return DEFAULT_CALENDAR_REMINDER_MINUTES;
  }

  return reminderMinutes;
}

export const stubGoogleCalendarClient: GoogleCalendarClient = {
  async createEvent(input, credentials) {
    if (!isConnectedGoogleCalendar(credentials)) {
      return {
        eventId: null,
        errorMessage: "Google Calendar is not connected.",
      };
    }

    const seed = [
      credentials.google_account_email ?? "primary",
      input.summary,
      input.start.dateTime,
      input.end.dateTime,
    ].join(":");
    const encodedSeed = Buffer.from(seed).toString("base64url").slice(0, 24);

    return {
      eventId: `google-calendar-stub-${encodedSeed}`,
      errorMessage: null,
    };
  },
};

export async function createGoogleCalendarEventForTask(
  task: CalendarTaskEventInput,
  credentials: GoogleCalendarCredentialSnapshot | null,
  options?: { client?: GoogleCalendarClient },
): Promise<CalendarTaskEventResult> {
  if (!task.calendarSyncEnabled) {
    return { status: "skipped", eventId: null, failureReason: null };
  }

  if (!hasScheduledWindow(task)) {
    return {
      status: "skipped",
      eventId: null,
      failureReason: "Task is not scheduled.",
    };
  }

  if (!isConnectedGoogleCalendar(credentials)) {
    return {
      status: "skipped",
      eventId: null,
      failureReason: "Google Calendar is not connected.",
    };
  }

  const connectedCredentials = credentials as GoogleCalendarCredentialSnapshot;
  const client = options?.client ?? stubGoogleCalendarClient;
  const result = await client.createEvent(
    {
      calendarId: "primary",
      summary: task.title,
      start: { dateTime: task.scheduledStartAt as string },
      end: { dateTime: task.scheduledEndAt as string },
      reminders: {
        useDefault: false,
        overrides: [
          {
            method: "popup",
            minutes: getReminderMinutes(task, connectedCredentials),
          },
        ],
      },
    },
    connectedCredentials,
  );

  if (result.errorMessage || !result.eventId) {
    return {
      status: "failed",
      eventId: null,
      failureReason:
        result.errorMessage ?? "Google Calendar event could not be created.",
    };
  }

  return {
    status: "synced",
    eventId: result.eventId,
    failureReason: null,
  };
}
