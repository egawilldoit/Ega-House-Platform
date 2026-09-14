import Link from "next/link";
import { ArrowRight, CalendarCheck2, Timer } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { LiveDuration } from "@/components/timer/live-duration";
import { formatTaskToken } from "@/lib/task-domain";

import type { HomeModel } from "../_lib/home-page-model";
import { HomeQuickActions } from "./home-quick-actions";

function TaskContext({ projectName, goalTitle }: { projectName: string; goalTitle: string | null }) {
  return (
    <p className="text-xs uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
      {projectName}
      {goalTitle ? ` · ${goalTitle}` : ""}
    </p>
  );
}

function ActiveTimerCard({ model }: { model: HomeModel }) {
  const activeTimer = model.activeTimer;
  if (!activeTimer) return null;

  return (
    <Card className="home-primary-card border-[var(--border)] bg-white" data-testid="home-active-timer">
      <CardContent className="space-y-3 px-6 pb-6 pt-6">
        <p className="glass-label text-signal-live inline-flex items-center gap-2">
          <Timer className="h-3.5 w-3.5" aria-hidden="true" />
          Focus running
        </p>
        <h2 className="font-display text-2xl font-semibold tracking-tight">
          {activeTimer.task?.title ?? "Timer active"}
        </h2>
        {activeTimer.task ? (
          <TaskContext projectName={activeTimer.task.projectName} goalTitle={activeTimer.task.goalTitle} />
        ) : null}
        {activeTimer.startedAt ? (
          <LiveDuration startedAt={activeTimer.startedAt} />
        ) : null}
        <Link href="/timer" className="btn-instrument inline-flex h-9 items-center gap-2 px-4 text-sm">
          Open timer
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </CardContent>
    </Card>
  );
}

function StartHereCard({ model }: { model: HomeModel }) {
  const task = model.startHere;

  if (!task) {
    return (
      <Card className="home-primary-card border-[var(--border)] bg-white" data-testid="home-start-here-empty">
        <CardContent className="space-y-3 px-6 pb-6 pt-6">
          <p className="glass-label text-etch">Start here</p>
          <h2 className="font-display text-xl font-semibold tracking-tight">Nothing queued right now</h2>
          <p className="text-sm leading-6 text-[color:var(--muted-foreground)]">
            Capture a thought or create a task to give Home something to work with.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="home-primary-card border-[var(--border)] bg-white" data-testid="home-start-here">
      <CardContent className="space-y-3 px-6 pb-6 pt-6">
        <p className="glass-label text-signal-live">Start here</p>
        <h2 className="font-display text-2xl font-semibold tracking-tight">{task.title}</h2>
        <TaskContext projectName={task.projectName} goalTitle={task.goalTitle} />
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={task.status} />
          {task.priority === "high" || task.priority === "urgent" ? (
            <Badge tone="warn">{formatTaskToken(task.priority)}</Badge>
          ) : null}
        </div>
        <Link href="/timer" className="btn-instrument inline-flex h-9 items-center gap-2 px-4 text-sm">
          Open timer
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </CardContent>
    </Card>
  );
}

function AttentionLine({ model }: { model: HomeModel }) {
  const { overdue, dueToday, reviewMissing } = model.attention;
  const clear = overdue === 0 && dueToday === 0 && !reviewMissing;

  return (
    <div className="home-attention flex flex-wrap items-center gap-2" aria-label="What needs attention">
      <span className="glass-label text-etch">Attention</span>
      {overdue > 0 ? (
        <Link href="/tasks?due=overdue">
          <Badge tone="error">{overdue} overdue</Badge>
        </Link>
      ) : null}
      {dueToday > 0 ? (
        <Link href="/tasks?due=due_today">
          <Badge tone="warn">{dueToday} due today</Badge>
        </Link>
      ) : null}
      {reviewMissing ? (
        <Link href="/review">
          <Badge tone="warn">Review due</Badge>
        </Link>
      ) : null}
      {clear ? (
        <span className="text-sm text-[color:var(--muted-foreground)]">You’re clear right now.</span>
      ) : null}
    </div>
  );
}

function NextUpCard({ model }: { model: HomeModel }) {
  const task = model.nextUp;
  if (!task) return null;

  return (
    <Card className="home-next-up border-[var(--border)] bg-white" data-testid="home-next-up">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 px-6 pb-5 pt-5">
        <div className="min-w-0">
          <p className="glass-label text-etch">Next up</p>
          <p className="mt-1 truncate text-base font-medium text-[color:var(--foreground)]">{task.title}</p>
          <TaskContext projectName={task.projectName} goalTitle={task.goalTitle} />
        </div>
        <Link href="/tasks" className="btn-instrument btn-instrument-muted inline-flex h-9 items-center gap-2 px-3 text-sm">
          Open Tasks
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </CardContent>
    </Card>
  );
}

export function AuthenticatedHomePage({ model }: { model: HomeModel }) {
  return (
    <div className="home-workspace-stack space-y-5">
      {model.activeTimer ? <ActiveTimerCard model={model} /> : <StartHereCard model={model} />}

      <AttentionLine model={model} />

      <HomeQuickActions />

      <NextUpCard model={model} />

      {model.snapshotUnavailable ? (
        <p className="text-xs text-[color:var(--muted-foreground)]" data-testid="home-degraded">
          <CalendarCheck2 className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
          Suggested work is unavailable right now. Your quick actions still work.
        </p>
      ) : null}
    </div>
  );
}
