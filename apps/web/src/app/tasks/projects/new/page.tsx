import { randomUUID } from "node:crypto";

import type { Metadata } from "next";

import {
  PROJECT_TEMPLATES,
  resolveProjectTemplatePreview,
  type ProjectTemplatePreview,
} from "@ega/application";

import { AppShell } from "@/components/layout/app-shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getWebTimeContext } from "@/lib/services/time-context-service";

import type { TemplatePickerOption } from "./_components/template-picker";
import { CreateProjectForm } from "./create-project-form";

export const metadata: Metadata = {
  title: "Create Project | Tasks",
  description: "Create a project from a template in the tasks workspace.",
};

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
  const timeContext = await getWebTimeContext();

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
    <AppShell
      title="New project"
      description="Add a project to anchor goals and tasks in the workspace."
    >
      <div className="mx-auto w-full max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle>New project</CardTitle>
            <CardDescription>
              Pick a template to pre-create goals and tasks, or start blank. Name and
              slug are required; slugs are normalized to lowercase, hyphenated format.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateProjectForm
              templateOptions={templateOptions}
              operationId={randomUUID()}
            />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
