import {
  computeWindowForRange,
  type AnalyticsRange,
} from "@/lib/services/work-analytics-filters";
import { getCompletedTaskCountForWindow, getWorkAnalyticsSessionsForWindow } from "@/lib/services/work-analytics-data-adapter";
import { calculateWorkAnalytics } from "@/lib/services/work-analytics-service";
import { requireAuthenticatedUser } from "@/lib/services/auth-service";
import {
  getHomeCompletedTaskPreview,
  getHomeDeadlinePreview,
  getHomeOverdueTaskPreview,
  getHomeUpcomingTaskPreview,
  getOpenTaskCount,
  getProjectDashboardCounts,
  type HomeTaskPreviewGroup,
} from "@/lib/services/task-read-service";
import { getWebTimeContext } from "@/lib/services/time-context-service";
import { createClient } from "@/lib/supabase/server";
import {
  shiftDateOnlyValue,
} from "@/lib/task-due-date";

/**
 * Server-composed aggregate inputs for the Home dashboard.
 *
 * Every value comes from a canonical read owner: task aggregates from
 * `task-read-service`, the completed/tracked week windows from the Work
 * Analytics window + evidence helpers, project scope and Goal health from the
 * Projects/Goals tables via `task-read-service`. A failed read stays `null` so
 * Home can render "Unavailable" instead of inventing a zero.
 */

export type HomeDashboardTask = {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  projectName: string | null;
  projectSlug: string | null;
};

export type HomeDashboardGroup = {
  count: number | null;
  tasks: HomeDashboardTask[];
};

export type HomeDashboardData = {
  /** Canonical owner-local date, or "" when Time Context was unavailable. */
  today: string;
  stats: {
    activeProjects: { count: number | null; atRiskCount: number | null } | null;
    openTasks: number | null;
    completedThisWeek: number | null;
    trackedThisWeekMinutes: number | null;
  };
  deadlines: {
    today: HomeDashboardGroup;
    tomorrow: HomeDashboardGroup;
    thisWeek: HomeDashboardGroup;
  };
  myTasks: {
    upcoming: HomeDashboardGroup;
    overdue: HomeDashboardGroup;
    completed: HomeDashboardGroup;
  };
};

export const HOME_DEADLINE_PREVIEW_LIMIT = 4;
export const HOME_MY_TASKS_PREVIEW_LIMIT = 5;

const HOME_WEEK_RANGE: AnalyticsRange = "this-week";

export function getHomeDeadlineWindows(today: string) {
  const tomorrow = shiftDateOnlyValue(today, 1);

  return {
    todayFrom: today,
    todayTo: today,
    tomorrowFrom: tomorrow,
    tomorrowTo: tomorrow,
    // Mirrors the canonical `next_7_days` due bucket: today through +7. Home
    // labels it "This week" and states the real window in its accessible name.
    thisWeekFrom: today,
    thisWeekTo: shiftDateOnlyValue(today, 7),
  };
}

function unavailableGroup(): HomeDashboardGroup {
  return { count: null, tasks: [] };
}

export function emptyHomeDashboardData(): HomeDashboardData {
  return {
    today: "",
    stats: {
      activeProjects: null,
      openTasks: null,
      completedThisWeek: null,
      trackedThisWeekMinutes: null,
    },
    deadlines: {
      today: unavailableGroup(),
      tomorrow: unavailableGroup(),
      thisWeek: unavailableGroup(),
    },
    myTasks: {
      upcoming: unavailableGroup(),
      overdue: unavailableGroup(),
      completed: unavailableGroup(),
    },
  };
}

export function toHomeDashboardGroup(
  result: { data: HomeTaskPreviewGroup | null; errorMessage: string | null } | undefined,
): HomeDashboardGroup {
  if (!result || result.errorMessage || !result.data) {
    return unavailableGroup();
  }

  return {
    count: result.data.count,
    tasks: result.data.rows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      priority: row.priority,
      dueDate: row.due_date,
      projectName: row.projects?.name ?? null,
      projectSlug: row.projects?.slug ?? null,
    })),
  };
}

export async function getHomeDashboardData(): Promise<HomeDashboardData> {
  try {
    const user = await requireAuthenticatedUser();
    const [context, supabase] = await Promise.all([getWebTimeContext(), createClient()]);

    const now = new Date();
    const today = context.localDate;
    const windows = getHomeDeadlineWindows(today);
    const weekWindow = computeWindowForRange(HOME_WEEK_RANGE, now, context.timezone);

    const [
      projectCounts,
      openTaskCount,
      todayDeadlines,
      tomorrowDeadlines,
      thisWeekDeadlines,
      upcomingTasks,
      overdueTasks,
      completedTasks,
    ] = await Promise.all([
      getProjectDashboardCounts({ ownerUserId: user.id, supabase }),
      getOpenTaskCount({ ownerUserId: user.id, supabase }),
      getHomeDeadlinePreview({
        ownerUserId: user.id,
        dueFrom: windows.todayFrom,
        dueTo: windows.todayTo,
        limit: HOME_DEADLINE_PREVIEW_LIMIT,
        supabase,
      }),
      getHomeDeadlinePreview({
        ownerUserId: user.id,
        dueFrom: windows.tomorrowFrom,
        dueTo: windows.tomorrowTo,
        limit: HOME_DEADLINE_PREVIEW_LIMIT,
        supabase,
      }),
      getHomeDeadlinePreview({
        ownerUserId: user.id,
        dueFrom: windows.thisWeekFrom,
        dueTo: windows.thisWeekTo,
        limit: HOME_DEADLINE_PREVIEW_LIMIT,
        supabase,
      }),
      getHomeUpcomingTaskPreview({
        ownerUserId: user.id,
        today,
        limit: HOME_MY_TASKS_PREVIEW_LIMIT,
        supabase,
      }),
      getHomeOverdueTaskPreview({
        ownerUserId: user.id,
        today,
        limit: HOME_MY_TASKS_PREVIEW_LIMIT,
        supabase,
      }),
      getHomeCompletedTaskPreview({
        ownerUserId: user.id,
        limit: HOME_MY_TASKS_PREVIEW_LIMIT,
        supabase,
      }),
    ]);

    let completedThisWeekCount: number | null = null;
    let trackedThisWeekMinutes: number | null = null;

    void Promise.all([
      getCompletedTaskCountForWindow({ ownerUserId: user.id, window: weekWindow, supabase }),
      getWorkAnalyticsSessionsForWindow({ ownerUserId: user.id, window: weekWindow, supabase }),
    ])
      .then(([completedTaskCount, weekSessions]) => {
        completedThisWeekCount = completedTaskCount.data;
        if (weekSessions.data && !weekSessions.errorMessage) {
          try {
            trackedThisWeekMinutes = calculateWorkAnalytics(weekSessions.data, weekWindow, {
              nowIso: now.toISOString(),
              includeOpenSessions: false,
              timezone: context.timezone,
            }).totalWorkedMinutes;
          } catch {
            trackedThisWeekMinutes = null;
          }
        }
      })
      .catch(() => {
        completedThisWeekCount = null;
        trackedThisWeekMinutes = null;
      });

    return {
      today,
      stats: {
        activeProjects: projectCounts.data
          ? {
              count: projectCounts.data.activeCount,
              atRiskCount: projectCounts.data.atRiskCount,
            }
          : null,
        openTasks: openTaskCount.count,
        completedThisWeek: completedThisWeekCount,
        trackedThisWeekMinutes,
      },
      deadlines: {
        today: toHomeDashboardGroup(todayDeadlines),
        tomorrow: toHomeDashboardGroup(tomorrowDeadlines),
        thisWeek: toHomeDashboardGroup(thisWeekDeadlines),
      },
      myTasks: {
        upcoming: toHomeDashboardGroup(upcomingTasks),
        overdue: toHomeDashboardGroup(overdueTasks),
        completed: toHomeDashboardGroup(completedTasks),
      },
    };
  } catch {
    return emptyHomeDashboardData();
  }
}
