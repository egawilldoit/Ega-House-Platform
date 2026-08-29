import type { OperatorProposalRecord } from "@ega/application/operator/lifecycle";
import Link from "next/link";

import {
  applyApprovedOperatorProposalAction,
  approveOperatorProposalAction,
  createOperatorProposalAction,
} from "@/app/today/operator-actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatTaskEstimate } from "@/lib/task-estimate";
import type { TodayPlannerTask } from "@/lib/services/today-planner-service";

function proposalStatusLabel(status: OperatorProposalRecord["status"]) {
  if (status === "generated") return "Needs approval";
  if (status === "approved") return "Approved";
  if (status === "applied" || status === "partially_applied") return "Applied";
  return status.replaceAll("_", " ");
}

export function TodayOperatorPlan({
  tasks,
  proposal,
  proposalError,
  returnTo,
}: {
  tasks: TodayPlannerTask[];
  proposal: OperatorProposalRecord | null;
  proposalError: string | null;
  returnTo: string;
}) {
  const planTasks = proposal
    ? proposal.proposedTaskIds.map((id) => tasks.find((task) => task.id === id)).filter(Boolean) as TodayPlannerTask[]
    : [];

  return (
    <Card className="today-operator-plan-panel">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="glass-label text-signal-live">Daily Operator</p>
            <CardTitle className="mt-1 text-xl">Primary plan</CardTitle>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-[color:var(--muted-foreground)]">
              Review the recommended lane before anything is added to Today. Operator suggestions never change work silently.
            </p>
          </div>
          {proposal ? <Badge tone={proposal.status === "generated" ? "warn" : "success"}>{proposalStatusLabel(proposal.status)}</Badge> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        {proposalError ? (
          <div className="today-intelligence-unavailable" role="status">
            <Badge tone="muted">Unavailable</Badge>
            <p>{proposalError} Your current Today work remains unchanged.</p>
          </div>
        ) : proposal ? (
          <>
            <div className="space-y-2">
              {planTasks.length > 0 ? planTasks.map((task, index) => (
                <div key={task.id} className="today-operator-plan-row">
                  <span className="today-focus-rank" aria-hidden="true">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[color:var(--foreground)]">{task.title}</p>
                    <p className="mt-1 truncate text-xs text-[color:var(--muted-foreground)]">
                      {task.projectName}{task.goalTitle ? ` · ${task.goalTitle}` : ""}
                      {task.estimateMinutes ? ` · ${formatTaskEstimate(task.estimateMinutes)}` : ""}
                    </p>
                  </div>
                  <Badge tone="muted">{task.priority}</Badge>
                </div>
              )) : (
                <p className="text-sm text-[color:var(--muted-foreground)]">The plan’s tasks changed. Refresh to review the current lane.</p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {proposal.status === "generated" ? (
                <form action={approveOperatorProposalAction}>
                  <input type="hidden" name="proposalId" value={proposal.id} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <button type="submit" className="btn-instrument h-9 px-3">Approve plan</button>
                </form>
              ) : null}
              {proposal.status === "approved" ? (
                <form action={applyApprovedOperatorProposalAction}>
                  <input type="hidden" name="proposalId" value={proposal.id} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <button type="submit" className="btn-instrument h-9 px-3">Apply to Today</button>
                </form>
              ) : null}
              <Link href="/tasks" className="btn-instrument btn-instrument-muted inline-flex h-9 items-center px-3">Adjust in Tasks</Link>
              <Link href="/today" className="btn-instrument btn-instrument-muted inline-flex h-9 items-center px-3">Refresh plan</Link>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm leading-6 text-[color:var(--muted-foreground)]">
              Prepare a short, explainable plan from the current focus lane, then approve it before it changes Today.
            </p>
            <form action={createOperatorProposalAction} className="space-y-3">
              {tasks.slice(0, 6).map((task) => <input key={task.id} type="hidden" name="taskId" value={task.id} />)}
              <input type="hidden" name="returnTo" value={returnTo} />
              <div className="flex flex-wrap items-center gap-2">
                <button type="submit" className="btn-instrument h-9 px-3" disabled={tasks.length === 0}>Prepare approval plan</button>
                <Link href="/tasks" className="btn-instrument btn-instrument-muted inline-flex h-9 items-center px-3">Adjust in Tasks</Link>
              </div>
            </form>
          </>
        )}
      </CardContent>
    </Card>
  );
}
