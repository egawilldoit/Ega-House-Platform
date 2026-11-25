import { createClient } from "@/lib/supabase/server";
import {
  DEFAULT_CALENDAR_REMINDER_MINUTES,
  getCalendarIntegrationSettings,
} from "@/lib/services/calendar-settings-service";

export type CreateProjectOption = { id: string; name: string };
export type CreateGoalOption = { id: string; title: string; project_id: string };
export type CreateCalendarDefaults = {
  connected: boolean;
  scheduledTaskSyncEnabled: boolean;
  defaultReminderMinutes: number;
};

export type CreateOptions = {
  projects: CreateProjectOption[];
  goals: CreateGoalOption[];
  calendarDefaults?: CreateCalendarDefaults;
  errorMessage: string | null;
};

const DEFAULT_CREATE_CALENDAR_DEFAULTS: CreateCalendarDefaults = {
  connected: false,
  scheduledTaskSyncEnabled: false,
  defaultReminderMinutes: DEFAULT_CALENDAR_REMINDER_MINUTES,
};

/**
 * Bounded, request-scoped read used only when a global create surface opens.
 * The shell no longer loads these options eagerly; RLS keeps the rows scoped
 * to the authenticated owner.
 */
export async function getCreateOptions(options?: {
  supabase?: Awaited<ReturnType<typeof createClient>>;
}): Promise<CreateOptions> {
  const supabase = options?.supabase ?? (await createClient());
  const [projectsResult, goalsResult, calendarResult] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name")
      .order("name", { ascending: true })
      .limit(24),
    supabase
      .from("goals")
      .select("id, title, project_id")
      .order("created_at", { ascending: false })
      .limit(50),
    getCalendarIntegrationSettings({ supabase }).catch(() => null),
  ]);

  const calendarDefaults: CreateCalendarDefaults = calendarResult?.data
    ? {
        connected: calendarResult.data.connected && !calendarResult.data.needsReconnect,
        scheduledTaskSyncEnabled: calendarResult.data.scheduledTaskSyncEnabled,
        defaultReminderMinutes: calendarResult.data.defaultReminderMinutes,
      }
    : DEFAULT_CREATE_CALENDAR_DEFAULTS;

  if (projectsResult.error || goalsResult.error) {
    return {
      projects: [],
      goals: [],
      calendarDefaults,
      errorMessage: "Create options are unavailable right now.",
    };
  }

  return {
    projects: projectsResult.data ?? [],
    goals: goalsResult.data ?? [],
    calendarDefaults,
    errorMessage: null,
  };
}
