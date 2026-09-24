import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { CreateProjectForm } from "./create-project-form";

export const metadata: Metadata = {
  title: "Create Project | Tasks",
  description: "Create a project in the tasks workspace.",
};

export default function NewProjectPage() {
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
              Name and slug are required. Slugs are normalized to lowercase, hyphenated format.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateProjectForm />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
