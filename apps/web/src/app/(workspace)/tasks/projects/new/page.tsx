import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";

import {
  PROJECT_TEMPLATES,
  createAuthenticatedActor,
  resolveProjectTemplatePreview,
  type ProjectTemplatePreview,
} from "@ega/application";
import { SupabaseProjectsRepository } from "@ega/data-access";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireAuthenticatedUser } from "@/lib/services/auth-service";
import { getWebTimeContext } from "@/lib/services/time-context-service";
import { createClient } from "@/lib/supabase/server";

import type { TemplatePickerOption } from "./_components/template-picker";
import { CreateProjectForm } from "./create-project-form";

export const metadata: Metadata = {
  title: "Create Project | Tasks",
  description: "Create a project from a template in the tasks workspace.",
};

async function getAreas() {
  const supabase = await createClient();
  const user = await requireAuthenticatedUser({ supabase });
  const repository = new SupabaseProjectsRepository(supabase);
  const result = await repository.listAreas(createAuthenticatedActor(user.id));

  if (!result.ok) {
    throw new Error("Unable to load areas right now.");
  }

  return result.value;
}

/**
 * Server-side projection of a resolved template for the client picker. Dates
 * are resolved here (owner Time Context), never in the browser, and the same
 * resolver produces the payload the create action sends.
 */
function toTemplateOption(preview: ProjectTemplatePreview): TemplatePickerOption {
  return {
    id: preview.templateId,
    name: preview.name,
    summary: preview.summary,
    projectDescription: preview.projectDescription,
    goalCount: preview.goalCount,
    taskCount: preview.taskCount,
    goals: preview.goals.map((goal) => ({
      title: goal.title,
      description: goal.description,
      tasks: goal.tasks.map((task) => ({
        title: task.title,
        dueDate: task.dueDate,
        priority: task.priority,
        estimateMinutes: task.estimateMinutes,
      })),
    })),
  };
}

export default async function NewProjectPage() {
  const [areas, timeContext] = await Promise.all([
    getAreas(),
    getWebTimeContext(),
  ]);

  const templateOptions = PROJECT_TEMPLATES.map((definition) => {
    const preview = resolveProjectTemplatePreview({
      templateId: definition.id,
      localDate: timeContext.localDate,
    });

    if (!preview.ok) {
      // A broken template constant must not render a misleading preview.
      throw new Error(preview.errorMessage);
    }

    return toTemplateOption(preview.data);
  });

  return (
    <>
      <div className="mx-auto w-full max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle>New project</CardTitle>
            <CardDescription>
              Pick a template to pre-create goals and tasks, or start blank. Name and
              slug are required; slugs are normalized to lowercase, hyphenated format.
              Areas group projects in the sidebar and project directory.
            </CardDescription>
            <p className="text-[length:var(--text-meta)] text-ega-text-secondary">
              Need a new area?{" "}
              <Link href="/settings/areas" className="font-medium underline-offset-2 hover:underline">
                Manage areas in Settings
              </Link>
              .
            </p>
          </CardHeader>
          <CardContent>
            <CreateProjectForm
              areas={areas}
              templateOptions={templateOptions}
              operationId={randomUUID()}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
