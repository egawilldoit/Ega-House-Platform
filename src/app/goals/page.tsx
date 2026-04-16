import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { InlineGoalStatusForm } from "@/components/goals/inline-goal-status-form";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { formatTaskToken, getTaskStatusTone } from "@/lib/task-domain";

import { updateGoalStatusAction } from "./actions";
import { CreateGoalForm } from "./create-goal-form";

export const metadata: Metadata = {
  title: "Goals | EGA House",
  description: "Goals list and creation flow.",
};

type GoalsPageProps = {
  searchParams: Promise<{ goalUpdateError?: string; goalUpdateGoalId?: string }>;
};

async function getGoalsData() {
  const supabase = await createClient();
  const [projectsResult, goalsResult] = await Promise.all([
    supabase.from("projects").select("id, name").order("name", { ascending: true }),
    supabase.from("goals").select("id, title, description, status, updated_at, projects(name)").order("updated_at", { ascending: false }),
  ]);
  if (projectsResult.error) throw new Error(`Failed to load projects: ${projectsResult.error.message}`);
  if (goalsResult.error) throw new Error(`Failed to load goals: ${goalsResult.error.message}`);
  return { projects: projectsResult.data, goals: goalsResult.data };
}

export default async function GoalsPage({ searchParams }: GoalsPageProps) {
  const resolvedSearchParams = await searchParams;
  const goalUpdateError = resolvedSearchParams.goalUpdateError?.slice(0, 180) ?? null;
  const goalUpdateGoalId = resolvedSearchParams.goalUpdateGoalId ?? null;
  const { projects, goals } = await getGoalsData();

  return (
    <AppShell
      eyebrow="Goals · Strategic Tracking"
      title="Goals"
      description="Track strategic goals attached to projects."
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">

        {/* Goals table */}
        <Card label="Goal List" title={`${goals.length} goal${goals.length !== 1 ? "s" : ""}`}>
          {goals.length === 0 ? (
            <div className="py-10 text-center">
              <p className="glass-label text-etch">No goals yet</p>
            </div>
          ) : (
            <table className="instrument-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Project</th>
                  <th>Status</th>
                  <th>Update</th>
                </tr>
              </thead>
              <tbody>
                {goals.map((goal) => (
                  <tr key={goal.id} id={`goal-${goal.id}`} className="scroll-mt-20">
                    <td>
                      <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>{goal.title}</p>
                      {goal.description && (
                        <p className="glass-label text-etch mt-0.5 truncate max-w-[260px]">{goal.description}</p>
                      )}
                    </td>
                    <td>
                      <span className="glass-label" style={{ color: "var(--muted-foreground)" }}>
                        {goal.projects?.name ?? "—"}
                      </span>
                    </td>
                    <td>
                      <Badge tone={getTaskStatusTone(goal.status)}>
                        {formatTaskToken(goal.status)}
                      </Badge>
                    </td>
                    <td>
                      <InlineGoalStatusForm
                        action={updateGoalStatusAction}
                        goalId={goal.id}
                        returnTo="/goals"
                        defaultStatus={goal.status}
                        error={goalUpdateGoalId === goal.id ? goalUpdateError : null}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {/* Create goal */}
        <Card label="New Goal" title="Create goal">
          {projects.length === 0 ? (
            <p className="glass-label text-etch py-4">Create a project first.</p>
          ) : (
            <CreateGoalForm projects={projects} />
          )}
        </Card>

      </div>
    </AppShell>
  );
}
