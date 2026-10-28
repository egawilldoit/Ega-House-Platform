import Link from "next/link";
import { Diamond } from "lucide-react";

import type { ProjectGoalRecord } from "@ega/application";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  getGoalHealthColor,
  getGoalHealthLabel,
  getGoalHealthTone,
  toGoalHealthOrNull,
} from "@/lib/goal-health";
import { getGoalNextStepPreview } from "@/lib/goal-next-step";

type ProjectGoalsMilestonesProps = {
  goals: ProjectGoalRecord[];
};

function HealthLabel({ health }: { health: string | null }) {
  const value = toGoalHealthOrNull(health);

  if (!value) {
    return <Badge tone="muted">Health not set</Badge>;
  }

  return <Badge tone={getGoalHealthTone(value)}>{getGoalHealthLabel(value)}</Badge>;
}

export function ProjectGoalsMilestones({ goals }: ProjectGoalsMilestonesProps) {
  return (
    <Card
      label="Milestones"
      title="Project goals"
      action={<Badge tone="muted">{goals.length}</Badge>}
    >
      {goals.length ? (
        <ul
          className="rows max-h-[22rem] overflow-y-auto"
          aria-label="Goals as milestones"
        >
          {goals.map((goal) => {
            const nextStep = getGoalNextStepPreview(goal.nextStep);
            const healthColor = getGoalHealthColor(goal.health);

            return (
              <li key={goal.id} className="row items-start">
                <span
                  aria-hidden="true"
                  className="mt-1 inline-flex h-4 w-4 shrink-0 items-center justify-center"
                  style={{ color: healthColor }}
                >
                  <Diamond className="h-3.5 w-3.5" fill="currentColor" />
                </span>
                <span className="row-main min-w-0">
                  <Link
                    href={`/goals?view=all&goal=${goal.id}#goal-${goal.id}`}
                    className="row-title block truncate hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ega-focus-outline)]"
                  >
                    {goal.title}
                  </Link>
                  <span className="row-meta line-clamp-2">
                    {nextStep ? `Next: ${nextStep}` : "No next step set"}
                  </span>
                </span>
                <span className="row-actions">
                  <HealthLabel health={goal.health} />
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <CardContent>
          <p className="text-[length:var(--text-meta-lg)] leading-[var(--leading-snug)] text-ega-text-secondary">
            No goals are linked to this project yet. Goals linked here appear as milestones with
            health and their next step.
          </p>
        </CardContent>
      )}
    </Card>
  );
}
