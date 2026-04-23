import type { Metadata } from "next";

import { TasksWorkspaceShell } from "@/components/tasks/tasks-workspace-shell";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { CreateProjectForm } from "./create-project-form";

export const metadata: Metadata = {
  title: "Create Project | Tasks | EGA House",
  description: "Create a project in the tasks workspace.",
};

export default function NewProjectPage() {
  return (
    <TasksWorkspaceShell
      eyebrow="Tasks Workspace"
      title="Create Project"
      description="Add a project to anchor goals and tasks in the workspace."
      navigation={
        <>
          <Badge tone="accent">Create</Badge>
          <Badge>Projects</Badge>
          <Badge>Tasks MVP</Badge>
        </>
      }
    >
      <div className="mx-auto w-full max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle>New project</CardTitle>
            <CardDescription>
              Name and slug are required. Slugs are normalized to lowercase,
              hyphenated format.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-1">
            <CreateProjectForm />
          </CardContent>
        </Card>
      </div>
    </TasksWorkspaceShell>
  );
}
