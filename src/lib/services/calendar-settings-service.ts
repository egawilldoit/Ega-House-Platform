import { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export const GOOGLE_CALENDAR_PROVIDER = "google";
export const DEFAULT_CALENDAR_REMINDER_MINUTES = 10;
export const MAX_CALENDAR_REMINDER_MINUTES = 10080;

export type CalendarIntegrationSettingsView = {
  connected: boolean;
  googleAccountEmail: string | null;
  scheduledTaskSyncEnabled: boolean;
  defaultReminderMinutes: number;
};

export type CalendarTaskFormDefaults = {
  calendarSyncEnabled: boolean;
  calendarReminderMinutes: number;
};

type CalendarSettingsSafeRow = {
  owner_user_id: string;
  provider: string;
  google_account_email: string | null;
  scheduled_task_sync_enabled: boolean | null;
  default_reminder_minutes: number | null;
  connected_at: string | null;
  disconnected_at: string | null;
};

type CalendarSettingsSecretRow = CalendarSettingsSafeRow & {
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
  token_expires_at: string | null;
};

export type GoogleCalendarTokenConnectionInput = {
  accessToken: string;
  refreshToken?: string | null;
  expiresInSeconds?: number | null;
  googleAccountEmail?: string | null;
};

const CALENDAR_SETTINGS_SAFE_SELECT =
  "owner_user_id, provider, google_account_email, scheduled_task_sync_enabled, default_reminder_minutes, connected_at, disconnected_at";

function getDisconnectedSettings(): CalendarIntegrationSettingsView {
  return {
    connected: false,
    googleAccountEmail: null,
    scheduledTaskSyncEnabled: false,
    defaultReminderMinutes: DEFAULT_CALENDAR_REMINDER_MINUTES,
  };
}

function normalizeCalendarSettingsRow(
  row: CalendarSettingsSafeRow | null,
): CalendarIntegrationSettingsView {
  if (!row) {
    return getDisconnectedSettings();
  }

  const connected = Boolean(row.connected_at && !row.disconnected_at);

  return {
    connected,
    googleAccountEmail: connected ? row.google_account_email : null,
    scheduledTaskSyncEnabled: Boolean(row.scheduled_task_sync_enabled),
    defaultReminderMinutes: normalizeCalendarReminderMinutes(
      row.default_reminder_minutes,
    ),
  };
}

async function resolveSupabaseClient(supabase?: SupabaseServerClient) {
  if (supabase) {
    return supabase;
  }

  return createClient();
}

async function requireAuthenticatedUserId(supabase: SupabaseServerClient) {
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user?.id) {
    return {
      errorMessage: "Sign in to manage Calendar settings.",
      userId: null,
    };
  }

  return {
    errorMessage: null,
    userId: data.user.id,
  };
}

export function normalizeCalendarReminderMinutes(value: unknown) {
  const parsed = Number.parseInt(String(value ?? ""), 10);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_CALENDAR_REMINDER_MINUTES;
  }

  return Math.min(Math.max(parsed, 0), MAX_CALENDAR_REMINDER_MINUTES);
}

export function getCalendarTaskFormDefaults(
  settings: CalendarIntegrationSettingsView,
): CalendarTaskFormDefaults {
  return {
    calendarSyncEnabled: settings.connected && settings.scheduledTaskSyncEnabled,
    calendarReminderMinutes: settings.defaultReminderMinutes,
  };
}

export function assertCalendarSettingsViewHasNoSecrets(
  settings: CalendarIntegrationSettingsView,
) {
  const serialized = JSON.stringify(settings);
  return (
    !serialized.includes("access_token") &&
    !serialized.includes("refresh_token") &&
    !serialized.includes("tokenExpires")
  );
}

function getTokenExpiresAtIso(
  expiresInSeconds: number | null | undefined,
  nowIso: string,
) {
  if (!expiresInSeconds || !Number.isFinite(expiresInSeconds)) {
    return null;
  }

  return new Date(
    new Date(nowIso).getTime() + Math.max(0, expiresInSeconds) * 1000,
  ).toISOString();
}

export async function getCalendarIntegrationSettings(options?: {
  supabase?: SupabaseServerClient;
}) {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const authResult = await requireAuthenticatedUserId(supabase);

  if (authResult.errorMessage || !authResult.userId) {
    return {
      errorMessage: authResult.errorMessage,
      data: getDisconnectedSettings(),
    };
  }

  const { data, error } = await supabase
    .from("calendar_integration_settings")
    .select(CALENDAR_SETTINGS_SAFE_SELECT)
    .eq("owner_user_id", authResult.userId)
    .eq("provider", GOOGLE_CALENDAR_PROVIDER)
    .maybeSingle();

  if (error) {
    return {
      errorMessage: "Unable to load Calendar settings right now.",
      data: getDisconnectedSettings(),
    };
  }

  return {
    errorMessage: null,
    data: normalizeCalendarSettingsRow(data),
  };
}

export async function getCalendarIntegrationSecretSnapshot(options?: {
  supabase?: SupabaseServerClient;
}) {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const authResult = await requireAuthenticatedUserId(supabase);

  if (authResult.errorMessage || !authResult.userId) {
    return { errorMessage: authResult.errorMessage, data: null };
  }

  const { data, error } = await supabase
    .from("calendar_integration_settings")
    .select(
      `${CALENDAR_SETTINGS_SAFE_SELECT}, access_token_encrypted, refresh_token_encrypted, token_expires_at`,
    )
    .eq("owner_user_id", authResult.userId)
    .eq("provider", GOOGLE_CALENDAR_PROVIDER)
    .maybeSingle();

  if (error) {
    return {
      errorMessage: "Unable to load Calendar credentials right now.",
      data: null,
    };
  }

  return {
    errorMessage: null,
    data: data as CalendarSettingsSecretRow | null,
  };
}

export async function updateCalendarIntegrationDefaults(
  input: {
    scheduledTaskSyncEnabled: unknown;
    defaultReminderMinutes: unknown;
  },
  options?: {
    supabase?: SupabaseServerClient;
    updatedAtIso?: string;
  },
) {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const authResult = await requireAuthenticatedUserId(supabase);

  if (authResult.errorMessage || !authResult.userId) {
    return {
      errorMessage: authResult.errorMessage,
      data: getDisconnectedSettings(),
    };
  }

  const updatedAtIso = options?.updatedAtIso ?? new Date().toISOString();
  const { data, error } = await supabase
    .from("calendar_integration_settings")
    .upsert(
      {
        owner_user_id: authResult.userId,
        provider: GOOGLE_CALENDAR_PROVIDER,
        scheduled_task_sync_enabled: input.scheduledTaskSyncEnabled === "on",
        default_reminder_minutes: normalizeCalendarReminderMinutes(
          input.defaultReminderMinutes,
        ),
        updated_at: updatedAtIso,
      },
      { onConflict: "owner_user_id,provider" },
    )
    .select(CALENDAR_SETTINGS_SAFE_SELECT)
    .maybeSingle();

  if (error) {
    return {
      errorMessage: "Unable to save Calendar settings right now.",
      data: getDisconnectedSettings(),
    };
  }

  return {
    errorMessage: null,
    data: normalizeCalendarSettingsRow(data),
  };
}

export async function connectGoogleCalendarWithTokens(
  input: GoogleCalendarTokenConnectionInput,
  options?: {
    supabase?: SupabaseServerClient;
    updatedAtIso?: string;
  },
) {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const authResult = await requireAuthenticatedUserId(supabase);

  if (authResult.errorMessage || !authResult.userId) {
    return {
      errorMessage: authResult.errorMessage,
      data: getDisconnectedSettings(),
    };
  }

  const accessToken = input.accessToken.trim();
  const refreshToken = input.refreshToken?.trim() ?? null;

  if (!accessToken) {
    return {
      errorMessage: "Google Calendar did not return an access token.",
      data: getDisconnectedSettings(),
    };
  }

  if (!refreshToken) {
    return {
      errorMessage:
        "Google Calendar did not return a refresh token. Reconnect and approve offline Calendar access.",
      data: getDisconnectedSettings(),
    };
  }

  const updatedAtIso = options?.updatedAtIso ?? new Date().toISOString();
  const { data, error } = await supabase
    .from("calendar_integration_settings")
    .upsert(
      {
        owner_user_id: authResult.userId,
        provider: GOOGLE_CALENDAR_PROVIDER,
        google_account_email: input.googleAccountEmail?.trim() || null,
        access_token_encrypted: accessToken,
        refresh_token_encrypted: refreshToken,
        token_expires_at: getTokenExpiresAtIso(
          input.expiresInSeconds,
          updatedAtIso,
        ),
        connected_at: updatedAtIso,
        disconnected_at: null,
        updated_at: updatedAtIso,
      },
      { onConflict: "owner_user_id,provider" },
    )
    .select(CALENDAR_SETTINGS_SAFE_SELECT)
    .maybeSingle();

  if (error) {
    return {
      errorMessage: "Unable to connect Google Calendar right now.",
      data: getDisconnectedSettings(),
    };
  }

  return {
    errorMessage: null,
    data: normalizeCalendarSettingsRow(data),
  };
}

export async function disconnectGoogleCalendar(options?: {
  supabase?: SupabaseServerClient;
  updatedAtIso?: string;
}) {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const authResult = await requireAuthenticatedUserId(supabase);

  if (authResult.errorMessage || !authResult.userId) {
    return {
      errorMessage: authResult.errorMessage,
      data: getDisconnectedSettings(),
    };
  }

  const updatedAtIso = options?.updatedAtIso ?? new Date().toISOString();
  const { data, error } = await supabase
    .from("calendar_integration_settings")
    .upsert(
      {
        owner_user_id: authResult.userId,
        provider: GOOGLE_CALENDAR_PROVIDER,
        google_account_email: null,
        access_token_encrypted: null,
        refresh_token_encrypted: null,
        token_expires_at: null,
        connected_at: null,
        disconnected_at: updatedAtIso,
        scheduled_task_sync_enabled: false,
        updated_at: updatedAtIso,
      },
      { onConflict: "owner_user_id,provider" },
    )
    .select(CALENDAR_SETTINGS_SAFE_SELECT)
    .maybeSingle();

  if (error) {
    return {
      errorMessage: "Unable to disconnect Google Calendar right now.",
      data: getDisconnectedSettings(),
    };
  }

  return {
    errorMessage: null,
    data: normalizeCalendarSettingsRow(data),
  };
}
