import {
  DEFAULT_CALENDAR_REMINDER_MINUTES,
  GOOGLE_CALENDAR_PROVIDER,
  MAX_CALENDAR_REMINDER_MINUTES,
  normalizeCalendarReminderMinutes,
} from "@/lib/services/calendar-settings-service";
import {
  decryptCalendarToken,
  encryptCalendarToken,
} from "@/lib/services/calendar-token-crypto";

export type GoogleCalendarCredentialSnapshot = {
  owner_user_id?: string | null;
  provider: string;
  google_account_email: string | null;
  scheduled_task_sync_enabled: boolean | null;
  default_reminder_minutes: number | null;
  calendar_id?: string | null;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
  token_expires_at: string | null;
  connected_at: string | null;
  disconnected_at: string | null;
};

export type GoogleCalendarEventInput = {
  calendarId: string;
  eventId?: string | null;
  summary: string;
  start: { dateTime: string };
  end: { dateTime: string };
  reminders: {
    useDefault: false;
    overrides: Array<{ method: "popup"; minutes: number }>;
  };
};

export type GoogleCalendarMutationResult =
  | {
      eventId: string;
      errorMessage: null;
      refreshedAccessToken?: string;
      tokenExpiresAt?: string | null;
    }
  | { eventId: null; errorMessage: string };

export type GoogleCalendarDeleteResult =
  | {
      ok: true;
      errorMessage: null;
      refreshedAccessToken?: string;
      tokenExpiresAt?: string | null;
    }
  | { ok: false; errorMessage: string };

export type GoogleCalendarClient = {
  createEvent(
    input: GoogleCalendarEventInput,
    credentials: GoogleCalendarCredentialSnapshot,
  ): Promise<GoogleCalendarMutationResult>;
  patchEvent(
    input: GoogleCalendarEventInput & { eventId: string },
    credentials: GoogleCalendarCredentialSnapshot,
  ): Promise<GoogleCalendarMutationResult>;
  deleteEvent(
    input: { calendarId: string; eventId: string },
    credentials: GoogleCalendarCredentialSnapshot,
  ): Promise<GoogleCalendarDeleteResult>;
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
  calendarEventId?: string | null;
  archivedAt?: string | null;
};

export type CalendarTaskEventResult =
  | {
      status: "synced";
      eventId: string | null;
      failureReason: null;
      refreshedAccessToken?: string;
      tokenExpiresAt?: string | null;
    }
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

function shouldDeleteCalendarEvent(task: CalendarTaskEventInput) {
  return Boolean(
    task.calendarEventId &&
      (!task.calendarSyncEnabled || !hasScheduledWindow(task) || task.archivedAt),
  );
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

function getGoogleCalendarId(credentials?: GoogleCalendarCredentialSnapshot | null) {
  return (
    credentials?.calendar_id?.trim() ||
    process.env.GOOGLE_CALENDAR_ID?.trim() ||
    "primary"
  );
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
  const refreshToken = decryptCalendarToken(credentials.refresh_token_encrypted);

  if (!clientId || !clientSecret || !refreshToken) {
    return {
      accessToken: null,
      encryptedAccessToken: null,
      tokenExpiresAt: null,
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
      encryptedAccessToken: null,
      tokenExpiresAt: null,
      errorMessage:
        payload.error_description ??
        payload.error ??
        "Google Calendar token refresh failed.",
    };
  }

  const tokenExpiresAt = payload.expires_in
    ? new Date(Date.now() + Math.max(0, payload.expires_in) * 1000).toISOString()
    : null;

  return {
    accessToken: payload.access_token,
    encryptedAccessToken: encryptCalendarToken(payload.access_token),
    tokenExpiresAt,
    errorMessage: null,
  };
}

async function resolveGoogleCalendarAccessToken(
  credentials: GoogleCalendarCredentialSnapshot,
) {
  if (!shouldRefreshAccessToken(credentials)) {
    return {
      accessToken: decryptCalendarToken(credentials.access_token_encrypted),
      encryptedAccessToken: null,
      tokenExpiresAt: null,
      errorMessage: null,
    };
  }

  return refreshGoogleCalendarAccessToken(credentials);
}

async function mutateGoogleCalendarEvent(
  method: "POST" | "PATCH",
  input: GoogleCalendarEventInput,
  credentials: GoogleCalendarCredentialSnapshot,
) {
  const tokenResult = await resolveGoogleCalendarAccessToken(credentials);

  if (tokenResult.errorMessage || !tokenResult.accessToken) {
    return {
      eventId: null,
      errorMessage:
        tokenResult.errorMessage ?? "Google Calendar access token is missing.",
    };
  }

  const eventPath = input.eventId
    ? `/events/${encodeURIComponent(input.eventId)}`
    : "/events";
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      input.calendarId,
    )}${eventPath}`,
    {
      method,
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
        payload.error?.message ?? "Google Calendar event could not be saved.",
    };
  }

  return {
    eventId: payload.id,
    errorMessage: null,
    ...(tokenResult.encryptedAccessToken
      ? {
          refreshedAccessToken: tokenResult.encryptedAccessToken,
          tokenExpiresAt: tokenResult.tokenExpiresAt,
        }
      : {}),
  };
}

export const googleCalendarClient: GoogleCalendarClient = {
  async createEvent(input, credentials) {
    return mutateGoogleCalendarEvent("POST", input, credentials);
  },

  async patchEvent(input, credentials) {
    return mutateGoogleCalendarEvent("PATCH", input, credentials);
  },

  async deleteEvent(input, credentials) {
    const tokenResult = await resolveGoogleCalendarAccessToken(credentials);

    if (tokenResult.errorMessage || !tokenResult.accessToken) {
      return {
        ok: false,
        errorMessage:
          tokenResult.errorMessage ?? "Google Calendar access token is missing.",
      };
    }

    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
        input.calendarId,
      )}/events/${encodeURIComponent(input.eventId)}`,
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${tokenResult.accessToken}` },
      },
    );

    if (response.status === 404 || response.status === 410) {
      return { ok: true, errorMessage: null };
    }

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      return {
        ok: false,
        errorMessage:
          payload.error?.message ?? "Google Calendar event could not be deleted.",
      };
    }

    return {
      ok: true,
      errorMessage: null,
      ...(tokenResult.encryptedAccessToken
        ? {
            refreshedAccessToken: tokenResult.encryptedAccessToken,
            tokenExpiresAt: tokenResult.tokenExpiresAt,
          }
        : {}),
    };
  },
};

export async function syncGoogleCalendarEventForTask(
  task: CalendarTaskEventInput,
  credentials: GoogleCalendarCredentialSnapshot | null,
  options?: { client?: GoogleCalendarClient },
): Promise<CalendarTaskEventResult> {
  if (!isConnectedGoogleCalendar(credentials)) {
    return {
      status: "skipped",
      eventId: null,
      failureReason: "Google Calendar is not connected.",
    };
  }

  const connectedCredentials = credentials as GoogleCalendarCredentialSnapshot;
  const client = options?.client ?? googleCalendarClient;
  const calendarId = getGoogleCalendarId(connectedCredentials);

  if (shouldDeleteCalendarEvent(task)) {
    const result = await client.deleteEvent(
      { calendarId, eventId: task.calendarEventId as string },
      connectedCredentials,
    );

    if (!result.ok) {
      return {
        status: "failed",
        eventId: null,
        failureReason: result.errorMessage,
      };
    }

    return {
      status: "synced",
      eventId: null,
      failureReason: null,
      ...(result.refreshedAccessToken
        ? {
            refreshedAccessToken: result.refreshedAccessToken,
            tokenExpiresAt: result.tokenExpiresAt,
          }
        : {}),
    };
  }

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

  const eventInput = {
    calendarId,
    eventId: task.calendarEventId,
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
  } satisfies GoogleCalendarEventInput;

  const result = task.calendarEventId
    ? await client.patchEvent(
        { ...eventInput, eventId: task.calendarEventId },
        connectedCredentials,
      )
    : await client.createEvent(eventInput, connectedCredentials);

  if (result.errorMessage || !result.eventId) {
    return {
      status: "failed",
      eventId: null,
      failureReason:
        result.errorMessage ?? "Google Calendar event could not be saved.",
    };
  }

  return {
    status: "synced",
    eventId: result.eventId,
    failureReason: null,
    ...(result.refreshedAccessToken
      ? {
          refreshedAccessToken: result.refreshedAccessToken,
          tokenExpiresAt: result.tokenExpiresAt,
        }
      : {}),
  };
}

export async function createGoogleCalendarEventForTask(
  task: CalendarTaskEventInput,
  credentials: GoogleCalendarCredentialSnapshot | null,
  options?: { client?: GoogleCalendarClient },
) {
  return syncGoogleCalendarEventForTask(task, credentials, options);
}
