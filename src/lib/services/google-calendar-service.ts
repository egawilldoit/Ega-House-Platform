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
  calendarId: string;
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

type TokenRefreshResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
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

function getGoogleCalendarId() {
  return process.env.GOOGLE_CALENDAR_ID?.trim() || "primary";
}

function getTokenExpiryDate(value: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function shouldRefreshAccessToken(credentials: GoogleCalendarCredentialSnapshot) {
  if (!credentials.refresh_token_encrypted) {
    return false;
  }

  const expiresAt = getTokenExpiryDate(credentials.token_expires_at);
  if (!credentials.access_token_encrypted || !expiresAt) {
    return true;
  }

  return expiresAt.getTime() <= Date.now() + 60_000;
}

async function refreshGoogleCalendarAccessToken(
  credentials: GoogleCalendarCredentialSnapshot,
) {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const refreshToken = credentials.refresh_token_encrypted?.trim();

  if (!clientId || !clientSecret || !refreshToken) {
    return {
      accessToken: null,
      errorMessage: "Google Calendar refresh credentials are not configured.",
    };
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as TokenRefreshResponse;

  if (!response.ok || !payload.access_token) {
    return {
      accessToken: null,
      errorMessage:
        payload.error_description ??
        payload.error ??
        "Google Calendar token refresh failed.",
    };
  }

  return { accessToken: payload.access_token, errorMessage: null };
}

async function resolveGoogleCalendarAccessToken(
  credentials: GoogleCalendarCredentialSnapshot,
) {
  if (!shouldRefreshAccessToken(credentials)) {
    return {
      accessToken: credentials.access_token_encrypted,
      errorMessage: null,
    };
  }

  return refreshGoogleCalendarAccessToken(credentials);
}

export const googleCalendarClient: GoogleCalendarClient = {
  async createEvent(input, credentials) {
    const tokenResult = await resolveGoogleCalendarAccessToken(credentials);

    if (tokenResult.errorMessage || !tokenResult.accessToken) {
      return {
        eventId: null,
        errorMessage:
          tokenResult.errorMessage ?? "Google Calendar access token is missing.",
      };
    }

    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
        input.calendarId,
      )}/events`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${tokenResult.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          summary: input.summary,
          start: input.start,
          end: input.end,
          reminders: input.reminders,
        }),
      },
    );

    const payload = (await response.json().catch(() => ({}))) as {
      id?: string;
      error?: { message?: string };
    };

    if (!response.ok || !payload.id) {
      return {
        eventId: null,
        errorMessage:
          payload.error?.message ?? "Google Calendar event could not be created.",
      };
    }

    return { eventId: payload.id, errorMessage: null };
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
  const client = options?.client ?? googleCalendarClient;
  const result = await client.createEvent(
    {
      calendarId: getGoogleCalendarId(),
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
