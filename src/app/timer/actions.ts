"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { resolveSessionConflict } from "@/app/timer/session-recovery";
import { getTimerActionReturnPath } from "@/app/timer/return-path";

function redirectToTimer(returnPath: string, errorMessage?: string): never {
  if (!errorMessage) {
    redirect(returnPath);
  }

  const target = new URL(returnPath, "https://egawilldoit.online");
  target.searchParams.set("actionError", errorMessage);
  redirect(`${target.pathname}${target.search}`);
}

export async function startTimerAction(formData: FormData) {
  const returnPath = getTimerActionReturnPath(formData.get("returnTo"));
  const taskId = String(formData.get("taskId") ?? "").trim();

  if (!taskId) {
    redirectToTimer(returnPath, "Select a task before starting the timer.");
  }

  const supabase = await createClient();
  const { data: openSessions, error: openSessionsError } = await supabase
    .from("task_sessions")
    .select("id, started_at")
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(2);

  if (openSessionsError) {
    redirectToTimer(returnPath, "Unable to verify active timer sessions.");
  }

  if ((openSessions?.length ?? 0) > 1) {
    redirectToTimer(
      returnPath,
      "Multiple open sessions detected. Resolve the conflict before starting a new timer.",
    );
  }

  if ((openSessions?.length ?? 0) === 1) {
    redirectToTimer(returnPath, "A timer is already running. Stop it first.");
  }

  const { error: insertError } = await supabase.from("task_sessions").insert({
    task_id: taskId,
    started_at: new Date().toISOString(),
  });

  if (insertError) {
    redirectToTimer(returnPath, "Unable to start timer right now.");
  }

  revalidatePath("/timer");
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  redirectToTimer(returnPath);
}

export async function stopTimerAction(formData: FormData) {
  const returnPath = getTimerActionReturnPath(formData.get("returnTo"));
  const submittedSessionId = String(formData.get("sessionId") ?? "").trim();
  const supabase = await createClient();

  const { data: openSessions, error: openSessionsError } = await supabase
    .from("task_sessions")
    .select("id, started_at")
    .is("ended_at", null)
    .order("started_at", { ascending: false });

  if (openSessionsError) {
    redirectToTimer(returnPath, "Unable to load open timer sessions.");
  }

  if ((openSessions?.length ?? 0) > 1) {
    redirectToTimer(
      returnPath,
      "Multiple open sessions detected. Resolve the conflict before stopping timers.",
    );
  }

  const targetSession = submittedSessionId
    ? openSessions?.find((session) => session.id === submittedSessionId)
    : openSessions?.[0];

  if (!targetSession) {
    redirectToTimer(returnPath, "No active timer session is available to stop.");
  }

  const endedAtIso = new Date().toISOString();
  const durationSeconds = Math.max(
    0,
    Math.floor(
      (new Date(endedAtIso).getTime() -
        new Date(targetSession.started_at).getTime()) /
        1000,
    ),
  );

  const { error: updateError } = await supabase
    .from("task_sessions")
    .update({
      ended_at: endedAtIso,
      duration_seconds: durationSeconds,
      updated_at: endedAtIso,
    })
    .eq("id", targetSession.id);

  if (updateError) {
    redirectToTimer(returnPath, "Unable to stop timer right now.");
  }

  revalidatePath("/timer");
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  redirectToTimer(returnPath);
}

export async function resolveSessionConflictAction(formData: FormData) {
  const returnPath = getTimerActionReturnPath(formData.get("returnTo"));
  const supabase = await createClient();

  const { data: openSessions, error: openSessionsError } = await supabase
    .from("task_sessions")
    .select("id, started_at")
    .is("ended_at", null);

  if (openSessionsError) {
    redirectToTimer(returnPath, "Unable to inspect open timer sessions.");
  }

  const resolution = resolveSessionConflict(openSessions ?? [], new Date().toISOString());

  if (!resolution) {
    redirectToTimer(returnPath);
  }

  for (const session of resolution.sessionsToClose) {
    const { error } = await supabase
      .from("task_sessions")
      .update({
        ended_at: session.endedAtIso,
        duration_seconds: session.durationSeconds,
        updated_at: session.endedAtIso,
      })
      .eq("id", session.id);

    if (error) {
      redirectToTimer(returnPath, "Unable to resolve timer session conflict.");
    }
  }

  revalidatePath("/timer");
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  redirectToTimer(returnPath);
}
