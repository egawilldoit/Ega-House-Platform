import Link from "next/link";
import type { Metadata } from "next";

import { PersonalOperationsForm } from "./personal-operations-form";

import { ChoiceGroup } from "@/app/(workspace)/settings/_components/choice-group";
import { SettingsNav } from "@/app/(workspace)/settings/_components/settings-nav";
import { updateWorkspacePreferencesAction } from "@/app/(workspace)/settings/preferences/actions";
import { requireSettingsPageUser } from "@/app/(workspace)/settings/_lib/settings-auth-guard";
import { WorkspacePageHeader } from "@/components/layout/workspace-page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { getWebTimeContext } from "@/lib/services/time-context-service";
import { getWebUserPreferencesState } from "@/lib/services/user-preferences-service";

export const metadata: Metadata = {
  title: "Preferences",
  description: "Personal schedule, launch page, default task layout and task detail behaviour.",
};

const PREFERENCES_PATH = "/settings/preferences";

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
  // Verify the request identity before any protected read.
  await requireSettingsPageUser(PREFERENCES_PATH);

  const [{ success, error }, state] = await Promise.all([
    searchParams,
    getWebUserPreferencesState(),
  ]);

  // The schedule can still be edited when the account time context is
  // unavailable; the form is told there is no local date to resolve.
  let timeContext: Awaited<ReturnType<typeof getWebTimeContext>> | null = null;
  try {
    timeContext = await getWebTimeContext();
  } catch {
    timeContext = null;
  }

  const preferences = state.preferences;
  const loadError = error ?? state.errorMessage;
  const fallbackTimezone =
    timeContext !== null
      ? timeContext.fallback === "missing_timezone" || timeContext.fallback === "invalid_timezone"
      : false;

  return (
    <>
      <WorkspacePageHeader
      title="Preferences"
      description="Where the workspace opens and how tasks are presented."
    />
      <div className="flex max-w-3xl flex-col gap-6">
        <SettingsNav active="preferences" />

        {loadError ? (
          <div role="alert" className="feedback-block feedback-block-error">
            {loadError} The schedule is read-only until preferences load.
          </div>
        ) : null}

        {success ? (
          <div role="status" className="feedback-block feedback-block-success">
            {success}
          </div>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Account time zone</CardTitle>
            <CardDescription>
              Day boundaries and today&apos;s plan use this zone.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p>
              Account time zone:{" "}
              <strong>{timeContext ? timeContext.timezone : "Unavailable"}</strong>{" "}
              <Link href="/settings/account">Change in Account settings</Link>
            </p>
            {fallbackTimezone ? (
              <div role="status" className="feedback-block">
                No valid time zone is stored for this account, so UTC is used for
                day boundaries. Set a time zone in Account settings.
              </div>
            ) : null}
            {timeContext === null ? (
              <p role="status" className="feedback-block">
                The account time zone could not be loaded right now. You can still
                edit and save the schedule; today&apos;s plan is unavailable.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Personal schedule</CardTitle><CardDescription>Targets and optional guidance in your account time zone.</CardDescription></CardHeader>
          <CardContent>
            <PersonalOperationsForm
              initial={preferences.personalOperations}
              disabled={Boolean(state.errorMessage)}
              timeContext={
                timeContext
                  ? {
                      timezone: timeContext.timezone,
                      fallback: timeContext.fallback,
                      localDate: timeContext.localDate,
                    }
                  : null
              }
            />
          </CardContent>
        </Card>

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
    </>
  );
}
