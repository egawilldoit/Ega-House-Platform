import type { Metadata } from "next";

import { ChoiceGroup } from "@/app/settings/_components/choice-group";
import { SettingsNav } from "@/app/settings/_components/settings-nav";
import { updateWorkspacePreferencesAction } from "@/app/settings/preferences/actions";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { getWebUserPreferencesState } from "@/lib/services/user-preferences-service";

export const metadata: Metadata = {
  title: "Preferences",
  description: "Launch page, default task layout and task detail behaviour.",
};

const LAUNCH_OPTIONS = [
  { value: "home", label: "Home", description: "Workspace overview and current focus." },
  { value: "today", label: "Today", description: "The daily execution plan." },
  { value: "tasks", label: "Tasks", description: "The full work inventory." },
] as const;

const LAYOUT_OPTIONS = [
  { value: "list", label: "List", description: "Dense, sortable rows." },
  { value: "kanban", label: "Kanban", description: "Status columns you can scan across." },
] as const;

const OPEN_MODE_OPTIONS = [
  { value: "panel", label: "Side panel", description: "Keeps the current list in view." },
  { value: "full", label: "Full page", description: "Gives the task detail the whole surface." },
] as const;

type WorkspacePreferencesPageProps = {
  searchParams: Promise<{ success?: string; error?: string }>;
};

export default async function WorkspacePreferencesPage({
  searchParams,
}: WorkspacePreferencesPageProps) {
  const [{ success, error }, state] = await Promise.all([
    searchParams,
    getWebUserPreferencesState(),
  ]);
  const preferences = state.preferences;
  const loadError = error ?? state.errorMessage;

  return (
    <AppShell
      title="Preferences"
      description="Where the workspace opens and how tasks are presented."
    >
      <div className="flex max-w-3xl flex-col gap-6">
        <SettingsNav active="preferences" />

        {loadError ? (
          <div role="alert" className="feedback-block feedback-block-error">
            {loadError} The defaults are shown; saving replaces the stored values.
          </div>
        ) : null}

        {success ? (
          <div role="status" className="feedback-block feedback-block-success">
            {success}
          </div>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Workspace defaults</CardTitle>
            <CardDescription>
              Stored on your account. Explicit list controls still win for the current view.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={updateWorkspacePreferencesAction} className="flex flex-col gap-6">
              <ChoiceGroup
                name="launchPage"
                legend="Open on launch"
                description="Where signing in and opening the workspace begins."
                value={preferences.launchPage}
                options={LAUNCH_OPTIONS}
                idPrefix="preferences-launch"
              />

              <ChoiceGroup
                name="taskLayout"
                legend="Default task layout"
                description="Used when the Tasks view has no explicit layout in its address."
                value={preferences.taskLayout}
                options={LAYOUT_OPTIONS}
                idPrefix="preferences-layout"
              />

              <ChoiceGroup
                name="taskOpenMode"
                legend="Open tasks in"
                description="The drawer controls still switch this for an individual selection."
                value={preferences.taskOpenMode}
                options={OPEN_MODE_OPTIONS}
                idPrefix="preferences-open-mode"
              />

              <div>
                <PendingSubmitButton type="submit" pendingLabel="Saving...">
                  Save preferences
                </PendingSubmitButton>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
