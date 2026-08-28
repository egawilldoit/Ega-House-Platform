import { createAuthenticatedActor, getOperatorSnapshot, type OperatorSnapshot } from "@ega/application";
import { SupabaseTodayReadPort } from "@ega/data-access";
import { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type OperatorSnapshotData = OperatorSnapshot;

export async function getOperatorSnapshotData(options?: {
  supabase?: SupabaseServerClient;
  now?: Date;
  actorId?: string;
}): Promise<{ data: OperatorSnapshotData | null; errorMessage: string | null }> {
  const supabase = options?.supabase ?? (await createClient());
  const now = options?.now ?? new Date();

  // Derive actor from supplied actorId or current user session.
  let actorId = options?.actorId ?? null;
  if (!actorId) {
    const { data: userData } = await supabase.auth.getUser();
    actorId = userData.user?.id ?? null;
  }
  if (!actorId) {
    return { data: null, errorMessage: "Authentication required." };
  }

  const actor = createAuthenticatedActor(actorId);
  const port = new SupabaseTodayReadPort(supabase as never);

  const result = await getOperatorSnapshot(actor, port, { now });
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
