import type { Metadata } from "next";

import { SettingsNav } from "@/app/(workspace)/settings/_components/settings-nav";
import {
  updatePersonalOperationsAction,
  updateWorkspacePreferencesAction,
} from "@/app/(workspace)/settings/preferences/actions";
import { PersonalOperationsForm } from "@/app/(workspace)/settings/preferences/personal-operations-form";
import { WorkspaceDefaultsForm } from "@/app/(workspace)/settings/preferences/workspace-defaults-form";
import { WorkspacePageHeader } from "@/components/layout/workspace-page-header";
import { getWebTimeContext } from "@/lib/services/time-context-service";
import { getWebUserPreferencesState } from "@/lib/services/user-preferences-service";

export const metadata: Metadata = {
  title: "Preferences",
  description:
    "Weekly targets, guidance blocks, launch page and task presentation.",
};

type WorkspacePreferencesPageProps = {
  searchParams: Promise<{ success?: string; error?: string }>;
};

export default async function WorkspacePreferencesPage({
  searchParams,
}: WorkspacePreferencesPageProps) {
  const [{ success, error }, state, timeContext] = await Promise.all([
    searchParams,
    getWebUserPreferencesState(),
    // Display-only: upcoming guidance is expressed in the account time zone.
    // A missing context keeps the schedule usable and hides that one line.
    getWebTimeContext().catch(() => null),
  ]);
  const preferences = state.preferences;
  const loadError = error ?? state.errorMessage;

  return (
    <>
      <WorkspacePageHeader
        title="Preferences"
        description="Your weekly rhythm, guidance and how the workspace opens."
      />
      <div className="flex w-full min-w-0 flex-col gap-6 pb-24">
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

        <PersonalOperationsForm
          initial={preferences.personalOperations}
          disabled={Boolean(state.errorMessage)}
          timezone={timeContext?.timezone ?? null}
          action={updatePersonalOperationsAction}
        />

        <WorkspaceDefaultsForm
          preferences={preferences}
          action={updateWorkspacePreferencesAction}
        />
      </div>
    </>
  );
}
