import type { Metadata } from "next";
import Link from "next/link";

import { createAuthenticatedActor } from "@ega/application";
import { SupabaseProjectsRepository } from "@ega/data-access";

import { AppShell } from "@/components/layout/app-shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireAuthenticatedUser } from "@/lib/services/auth-service";
import { createClient } from "@/lib/supabase/server";

import { CreateProjectForm } from "./create-project-form";

export const metadata: Metadata = {
  title: "Create Project | Tasks",
  description: "Create a project in the tasks workspace.",
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

export default async function NewProjectPage() {
  const areas = await getAreas();

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
            <CreateProjectForm areas={areas} />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
