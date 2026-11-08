import type { Metadata } from "next";

import { SettingsNav } from "@/app/(workspace)/settings/_components/settings-nav";
import {
  updatePersonalOperationsAction,
  updateWorkspacePreferencesAction,
} from "@/app/(workspace)/settings/preferences/actions";
import { PersonalOperationsForm } from "@/app/(workspace)/settings/preferences/personal-operations-form";
import { WorkspaceDefaultsForm } from "@/app/(workspace)/settings/preferences/workspace-defaults-form";
import {
  redirectToSettingsLogin,
  requireSettingsPageUser,
} from "@/app/(workspace)/settings/_lib/settings-auth-guard";
import { WorkspacePageHeader } from "@/components/layout/workspace-page-header";
import { isAuthServiceError } from "@/lib/services/auth-service";
import { getJobSearchReferenceOptions } from "@/lib/services/job-search-reference-options";
import { getWebTimeContext } from "@/lib/services/time-context-service";
import { getWebUserPreferencesState } from "@/lib/services/user-preferences-service";

export const metadata: Metadata = {
  title: "Preferences",
  description:
    "Weekly targets, guidance blocks, launch page and task presentation.",
};

const PREFERENCES_PATH = "/settings/preferences";

type WorkspacePreferencesPageProps = {
  searchParams: Promise<{ success?: string; error?: string }>;
};

export default async function WorkspacePreferencesPage({
  searchParams,
}: WorkspacePreferencesPageProps) {
  // Verify the request identity before any protected read. The returned user is
  // the request-memoized verified identity used only to scope the local draft
  // snapshot so same-baseline accounts in one tab cannot share a draft.
  const account = await requireSettingsPageUser(PREFERENCES_PATH);

  const [{ success, error }, state, referenceOptions] = await Promise.all([
    searchParams,
    getWebUserPreferencesState(),
    getJobSearchReferenceOptions(),
  ]);

  // The schedule can still be edited when the account time context is
  // unavailable; the form is told there is no local date to resolve. An expired
  // session is not a degradation, so auth failures still go to the login page.
  let timeContext: Awaited<ReturnType<typeof getWebTimeContext>> | null = null;
  try {
    timeContext = await getWebTimeContext();
  } catch (loadError) {
    if (isAuthServiceError(loadError)) {
      redirectToSettingsLogin(PREFERENCES_PATH);
    }
    timeContext = null;
  }

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
            {loadError}
            {state.errorMessage
              ? " The schedule is read-only until preferences load."
              : null}
          </div>
        ) : null}

        {success ? (
          <div role="status" className="feedback-block feedback-block-success">
            {success}
          </div>
        ) : null}

        {referenceOptions.errorMessage ? (
          <div role="status" className="feedback-block">
            {referenceOptions.errorMessage} Your saved job-search reference is kept.
          </div>
        ) : null}

        <PersonalOperationsForm
          initial={preferences.personalOperations}
          initialReference={preferences.jobSearchReference}
          referenceOptions={referenceOptions.data}
          disabled={Boolean(state.errorMessage)}
          timeContext={
            timeContext
              ? {
                  timezone: timeContext.timezone,
                  persistedTimezone: timeContext.persistedTimezone,
                  fallback: timeContext.fallback,
                  localDate: timeContext.localDate,
                }
              : null
          }
          accountScope={account.id}
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
