import { createAuthenticatedActor, getOperatorSnapshot, type OperatorSnapshot } from "@ega/application";
import { SupabaseTimeContextRepository, SupabaseTodayReadPort } from "@ega/data-access";
import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedUser } from "@/lib/services/auth-service";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type OperatorSnapshotData = OperatorSnapshot;

export async function getOperatorSnapshotData(options?: {
  supabase?: SupabaseServerClient;
  now?: Date;
  requestedTimezone?: string;
}): Promise<{ data: OperatorSnapshotData | null; errorMessage: string | null }> {
  const supabase = options?.supabase ?? (await createClient());
  const now = options?.now ?? new Date();

  let user;
  try {
    user = await requireAuthenticatedUser({ supabase });
  } catch {
    return { data: null, errorMessage: "Authentication required." };
  }

  const actor = createAuthenticatedActor(user.id);
  const port = new SupabaseTodayReadPort(supabase as never);
  const timeContextRepo = new SupabaseTimeContextRepository(supabase as never);

  const result = await getOperatorSnapshot(actor, port, timeContextRepo, { now, requestedTimezone: options?.requestedTimezone });
  if (!result.ok) {
    return { data: null, errorMessage: result.errorMessage };
  }

  return { data: result.data, errorMessage: null };
}

// Compatibility helper: maps OperatorSnapshot to legacy TodayPlannerData shape
// so existing Today page components can migrate incrementally.
// Prefer using OperatorSnapshot directly in new code.
export function toLegacyTodayPlannerData(snapshot: OperatorSnapshot) {
  return {
    date: snapshot.date,
    startHere: snapshot.focus.startHere,
    focusQueue: snapshot.focus.queue,
    plannedToday: snapshot.plannedToday,
    scheduledBlocks: snapshot.schedule.blocks,
    flexibleTasks: snapshot.schedule.flexible,
    planned: snapshot.sections.planned,
    inProgress: snapshot.sections.inProgress,
    blocked: snapshot.sections.blocked,
    completed: snapshot.sections.completed,
    suggestions: snapshot.suggestions,
    summary: snapshot.summary,
    activeTimer: snapshot.activeTimer
      ? {
          sessionId: snapshot.activeTimer.sessionId,
          taskId: snapshot.activeTimer.taskId,
          // Expand to legacy ActiveTimerSession shape where possible
          startedAt: "",
          elapsedLabel: "",
          taskTitle: "",
          taskStatus: "",
          taskPriority: "",
          projectName: "",
          projectSlug: null,
          goalTitle: null,
        }
      : null,
    signals: snapshot.signals,
  };
}
