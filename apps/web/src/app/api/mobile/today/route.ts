import { NextResponse } from "next/server";

import type { MobileTodayResponse, MobileTodayTaskItem } from "@/lib/contracts/mobile";
import type { TodayPlannerTask } from "@/lib/services/today-planner-service";
import { getTodayPlannerData } from "@/lib/services/today-planner-service";
import { isTaskPriority } from "@/lib/task-domain";
import { resolveMobileRequestAuth } from "@/app/api/mobile/_lib/auth";
import { mobileErrorResponse } from "@/app/api/mobile/_lib/helpers";

function mapTodayPlannerTaskToMobileTask(task: TodayPlannerTask): MobileTodayTaskItem {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    blockedReason: task.blockedReason,
    status: task.status,
    priority: isTaskPriority(task.priority) ? task.priority : "medium",
    dueDate: task.dueDate,
    estimateMinutes: task.estimateMinutes,
    updatedAt: task.updatedAt,
    focusRank: task.focusRank,
    plannedForDate: task.plannedForDate,
    projectName: task.projectName,
    projectSlug: task.projectSlug,
    goalTitle: task.goalTitle,
    hasActiveTimer: task.hasActiveTimer,
    isDueToday: task.isDueToday,
    isPlannedForToday: task.isPlannedForToday,
    dueBucket: task.dueBucket,
  };
}

export async function GET(request: Request) {
  const authResult = await resolveMobileRequestAuth(request);
  if (!authResult.ok) {
    return mobileErrorResponse(authResult.code, authResult.message, authResult.status);
  }

  const result = await getTodayPlannerData({
    supabase: authResult.supabase,
  });

  if (result.errorMessage || !result.data) {
    return mobileErrorResponse("INTERNAL_ERROR", result.errorMessage ?? "Unable to load Today data right now.", 500);
  }

  return NextResponse.json(
    {
      ok: true,
      date: result.data.date,
      sections: {
        planned: result.data.planned.map(mapTodayPlannerTaskToMobileTask),
        inProgress: result.data.inProgress.map(mapTodayPlannerTaskToMobileTask),
        blocked: result.data.blocked.map(mapTodayPlannerTaskToMobileTask),
        completed: result.data.completed.map(mapTodayPlannerTaskToMobileTask),
      },
      suggestions: {
        pinned: result.data.suggestions.pinned.map(mapTodayPlannerTaskToMobileTask),
        inProgress: result.data.suggestions.inProgress.map(mapTodayPlannerTaskToMobileTask),
      },
      summary: result.data.summary,
      activeTimer: result.data.activeTimer,
    } satisfies MobileTodayResponse,
    { status: 200 },
  );
}
