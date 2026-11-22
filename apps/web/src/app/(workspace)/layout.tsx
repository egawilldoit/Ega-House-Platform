import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { getShellIdentity, getSessionUser } from "@/lib/workspace-shell";
import { getActiveTimerSession } from "@/lib/services/timer-service";

import { ActiveTimerProvider } from "@/components/timer/floating-timer/active-timer-provider";
import { FloatingTimerChip } from "@/components/timer/floating-timer/floating-timer-chip";
import {
  QuickNotesLauncher,
  QuickNotesPanel,
} from "@/components/quick-notes/quick-notes-launcher";
import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { WorkspaceKeyboardShortcuts } from "@/components/layout/workspace-keyboard-shortcuts";
import { GlobalQuickActionControllers } from "@/components/layout/global-quick-action-controllers";
import { ToastProvider } from "@/components/ui/toast-provider";
import {
  ACTIVE_TIMER_UNAUTHENTICATED_MESSAGE,
  ACTIVE_TIMER_UNAVAILABLE_MESSAGE,
  toActiveTimerSnapshot,
  type ActiveTimerReadResult,
} from "@/lib/timer/active-timer-contract";

// minimal identity derivation helper not exported; inline
async function readInitialActiveTimer(): Promise<ActiveTimerReadResult> {
  const ownerUserId = (await getSessionUser())?.id ?? null;
  if (!ownerUserId) {
    return {
      ok: false,
      reason: "unauthenticated",
      message: ACTIVE_TIMER_UNAUTHENTICATED_MESSAGE,
    };
  }

  try {
    const result = await getActiveTimerSession();
    if (result.errorMessage) {
      return {
        ok: false,
        reason: "unavailable",
        message: ACTIVE_TIMER_UNAVAILABLE_MESSAGE,
      };
    }

    return {
      ok: true,
      syncedAt: new Date().toISOString(),
      session: toActiveTimerSnapshot(result.data),
    };
  } catch {
    return {
      ok: false,
      reason: "unavailable",
      message: ACTIVE_TIMER_UNAVAILABLE_MESSAGE,
    };
  }
}

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const identityPromise = getShellIdentity();
  const timerPromise = readInitialActiveTimer();

  // minimal unread notification badge
  let unreadNotificationCount = 0;
  try {
    const supabase = await createClient();
    const { count } = await (
      supabase as unknown as {
        from: (table: string) => {
          select: (
            columns: string,
            options: { count: "exact"; head: true },
          ) => {
            is: (column: string, value: null) => Promise<{ count: number | null }>;
          };
        };
      }
    )
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .is("read_at", null);
    unreadNotificationCount = count ?? 0;
  } catch {
    unreadNotificationCount = 0;
  }

  const [identity, initialActiveTimer] = await Promise.all([
    identityPromise,
    timerPromise,
  ]);

  const metrics = {
    hasActiveTimer: false,
    timerState: "idle" as const,
    blockedTaskCount: 0,
    overdueTaskCount: 0,
    dueTodayTaskCount: 0,
    unreadNotificationCount,
    reviewMissing: false,
    reviewSignal: "current" as const,
    taskActionCount: 0,
    totalActionCount: 0,
    highestPrioritySignal: "clear" as const,
  };

  return (
    <ToastProvider>
      <ActiveTimerProvider
        key={identity.id ?? "unauthenticated"}
        ownerUserId={identity.id}
        initialResult={initialActiveTimer}
      >
        <WorkspaceKeyboardShortcuts ownerId={identity.id} />
        <GlobalQuickActionControllers projects={[]} goals={[]} ownerId={identity.id} />

        <WorkspaceShell
          favorites={[]}
          projects={[]}
          metrics={metrics as never}
          identity={identity as never}
          topBarExtra={identity.id ? <QuickNotesLauncher /> : null}
        >
          {children}
        </WorkspaceShell>

        <FloatingTimerChip />
        {identity.id ? <QuickNotesPanel /> : null}
      </ActiveTimerProvider>
    </ToastProvider>
  );
}
