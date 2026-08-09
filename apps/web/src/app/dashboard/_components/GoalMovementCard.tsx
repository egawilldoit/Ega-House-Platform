import Link from "next/link";

import { Target } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { getGoalHealthLabel, getGoalHealthTone, toGoalHealthOrNull } from "@/lib/goal-health";
import { getGoalNextStepPreview } from "@/lib/goal-next-step";
import { formatTaskToken } from "@/lib/task-domain";

import type { DashboardData, DashboardGoalStatus } from "../_lib/dashboard-data";

interface GoalMovementCardProps {
  goals: DashboardData["goals"];
}

function GoalRow({ goal }: { goal: DashboardGoalStatus }) {
  const nextStepPreview = getGoalNextStepPreview(goal.nextStep, 72);
  const goalHealth = toGoalHealthOrNull(goal.health);

  return (
    <article className="ega-dashboard-list-row">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-[color:var(--foreground)]">
          {goal.title}
        </p>
        <p className="mt-2 text-xs leading-6 text-[color:var(--muted-foreground)]">
          {goal.projectName} · {goal.completedTaskCount}/{goal.linkedTaskCount} linked tasks complete
        </p>
        {nextStepPreview ? (
          <p className="mt-1 truncate text-xs text-[color:var(--muted-foreground)]">
            Next: {nextStepPreview}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <div className="hidden min-w-20 text-right sm:block">
          <div className="text-sm font-semibold text-[color:var(--foreground)]">
            {goal.progressPercent}%
          </div>
          <div className="text-[11px] uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]">
            Progress
          </div>
        </div>
        <StatusBadge status={goal.status} label={formatTaskToken(goal.status)} />
        {goalHealth ? (
          <Badge tone={getGoalHealthTone(goalHealth)}>{getGoalHealthLabel(goalHealth)}</Badge>
        ) : null}
      </div>
    </article>
  );
}

export function GoalMovementCard({ goals }: GoalMovementCardProps) {
  const goalItems = goals.data ?? [];

  return (
    <Card className="ega-glass">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="glass-label text-[color:var(--signal-live)]">Goal Movement</p>
            <CardTitle className="mt-2 text-xl">Existing goals on deck</CardTitle>
            <CardDescription>
              Strategic outcomes with progress and linked-task velocity.
            </CardDescription>
          </div>
          <CardAction>
            <Link href="/goals" className="glass-label text-signal-live">
              Open goals
            </Link>
          </CardAction>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {goals.error ? (
          <div className="feedback-block feedback-block-error">{goals.error}</div>
        ) : goalItems.length > 0 ? (
          goalItems.slice(0, 4).map((goal) => <GoalRow key={goal.id} goal={goal} />)
        ) : (
          <EmptyState
            icon={Target}
            title="No goals yet"
            description="Create goals to anchor strategic execution progress."
            actionLabel="Open goals"
            actionHref="/goals"
          />
        )}
      </CardContent>
    </Card>
  );
}
