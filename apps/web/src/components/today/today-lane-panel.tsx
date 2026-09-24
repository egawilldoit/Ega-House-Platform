import { startTimerAction } from "@/app/timer/actions";
import { TimerStopForm } from "@/components/timer/timer-stop-form";
import { Card, CardContent } from "@/components/ui/card";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import type { TodayPlannerTask } from "@/lib/services/today-planner-service";
import { formatTaskEstimate } from "@/lib/task-estimate";
import { isTaskCompletedStatus } from "@/lib/task-domain";
import { Play, Square } from "lucide-react";

type TodayLanePanelProps = {
  scheduledBlocks: TodayPlannerTask[];
  dueTodayCarryover: TodayPlannerTask[];
  flexibleTasks: TodayPlannerTask[];
  returnTo: string;
  activeTimerSessionId: string | null;
};

function LaneRow({
  task,
  label,
  returnTo,
  activeTimerSessionId,
}: {
  task: TodayPlannerTask;
  label: string;
  returnTo: string;
  activeTimerSessionId: string | null;
}) {
  const activeSessionId = task.hasActiveTimer ? activeTimerSessionId : null;
  const completed = isTaskCompletedStatus(task.status);

  return (
    <li className="row">
      <span className="row-main">
        <span className="row-title">{task.title}</span>
        <span className="row-meta">
          {task.projectName}
          {` · ${label}`}
          {task.estimateMinutes ? ` · ${formatTaskEstimate(task.estimateMinutes)}` : ""}
        </span>
      </span>
      {activeSessionId ? (
        <TimerStopForm sessionId={activeSessionId} returnTo={returnTo} size="sm">
          <Square className="h-3.5 w-3.5" aria-hidden="true" />
          Stop
        </TimerStopForm>
      ) : completed ? null : (
        <form action={startTimerAction}>
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <PendingSubmitButton type="submit" size="sm" variant="secondary" pendingLabel="Starting…">
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
            Focus
          </PendingSubmitButton>
        </form>
      )}
    </li>
  );
}

/**
 * The day lane: scheduled blocks first, then due-today carryover, then flexible
 * work. Every row can start (or stop) its own canonical focus session.
 */
export function TodayLanePanel({
  scheduledBlocks,
  dueTodayCarryover,
  flexibleTasks,
  returnTo,
  activeTimerSessionId,
}: TodayLanePanelProps) {
  const isEmpty =
    scheduledBlocks.length === 0 &&
    dueTodayCarryover.length === 0 &&
    flexibleTasks.length === 0;

  return (
    <Card label="Today lane" title="Schedule" data-testid="today-lane">
      {isEmpty ? (
        <CardContent>
          <p className="text-[length:var(--text-meta-lg)] text-[color:var(--ega-text-secondary)]">
            Nothing scheduled for today yet.
          </p>
        </CardContent>
      ) : (
        <ul className="rows">
          {scheduledBlocks.map((task) => (
            <LaneRow
              key={task.id}
              task={task}
              label="scheduled"
              returnTo={returnTo}
              activeTimerSessionId={activeTimerSessionId}
            />
          ))}
          {dueTodayCarryover.map((task) => (
            <LaneRow
              key={`carryover-${task.id}`}
              task={task}
              label="due today"
              returnTo={returnTo}
              activeTimerSessionId={activeTimerSessionId}
            />
          ))}
          {flexibleTasks.map((task) => (
            <LaneRow
              key={`flex-${task.id}`}
              task={task}
              label="flexible"
              returnTo={returnTo}
              activeTimerSessionId={activeTimerSessionId}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}
