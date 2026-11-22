import type { Metadata } from "next";

import {
  parseSettingsTab,
  SettingsTabs,
} from "@/app/(workspace)/settings/_components/settings-tabs";
import { ShortcutHelpButton } from "@/app/(workspace)/settings/_components/shortcut-help-button";
import { AccountSettings } from "@/app/(workspace)/settings/_components/account-settings";
import { AppearanceSettings } from "@/app/(workspace)/settings/_components/appearance-settings";
import { WorkspaceDefaultsForm } from "@/app/(workspace)/settings/_components/workspace-defaults-form";
import { WorkTargetsForm } from "@/app/(workspace)/settings/_components/work-targets-form";
import { NotificationPreferencesPanel } from "@/app/(workspace)/settings/_components/notification-preferences-panel";
import { IntegrationsSettings } from "@/app/(workspace)/settings/_components/integrations-settings";
import { updateAppearancePreferencesAction } from "@/app/(workspace)/settings/_actions/appearance-actions";
import { updateWorkspacePreferencesAction } from "@/app/(workspace)/settings/_actions/workspace-preferences-actions";
import { updateWorkTargetsAction } from "@/app/(workspace)/settings/_actions/work-targets-actions";
import {
  rethrowSettingsLoadError,
  requireSettingsPageUser,
} from "@/app/(workspace)/settings/_lib/settings-auth-guard";
import {
  getGoogleCalendarOAuthFailureMessage,
  type GoogleCalendarOAuthFailureCode,
} from "@/app/api/integrations/google-calendar/oauth";
import { WorkspacePageHeader } from "@/components/layout/workspace-page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getShellIdentity } from "@/lib/workspace-shell";
import { isAuthServiceError } from "@/lib/services/auth-service";
import { getCalendarIntegrationSettings } from "@/lib/services/calendar-settings-service";
import { listAgentRegistry } from "@/lib/services/agent-registry-service";
import {
  getWebNotificationPreferences,
  getWebNotificationSettings,
} from "@/lib/services/notification-service";
import { getWebTimeContext } from "@/lib/services/time-context-service";
import { getWebUserPreferencesState } from "@/lib/services/user-preferences-service";

export const metadata: Metadata = {
  title: "Settings",
  description: "Account, preferences, notifications and integrations.",
};

const SETTINGS_PATH = "/settings";

type SettingsPageProps = {
  searchParams: Promise<{
    tab?: string;
    success?: string;
    error?: string;
    errorCode?: GoogleCalendarOAuthFailureCode;
  }>;
};

function feedbackMessage(value: string | undefined) {
  return value?.trim().slice(0, 240) || null;
}

async function loadTimeContext(pathname: string, fatal: boolean) {
  try {
    return await getWebTimeContext();
  } catch (loadError) {
    if (isAuthServiceError(loadError)) {
      rethrowSettingsLoadError(loadError, pathname);
    }
    if (fatal) throw loadError;
    return null;
  }
}

function Feedback({
  success,
  error,
}: {
  success: string | null;
  error: string | null;
}) {
  return (
    <>
      {success ? (
        <div role="status" className="feedback-block feedback-block-success">
          {success}
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="feedback-block feedback-block-error">
          {error}
        </div>
      ) : null}
    </>
  );
}

async function AccountTab() {
  const [identity, timeContext] = await Promise.all([
    getShellIdentity(),
    loadTimeContext(SETTINGS_PATH, true),
  ]);
  if (!timeContext) throw new Error("Time context unavailable.");

  return <AccountSettings identity={identity} timeContext={timeContext} />;
}

async function PreferencesTab() {
  const [state, timeContext, preferencesResult, settingsResult] = await Promise.all([
    getWebUserPreferencesState(),
    loadTimeContext(SETTINGS_PATH, false),
    getWebNotificationPreferences().catch(() => ({
      data: null,
      errorMessage: "Unable to load notification preferences right now.",
    })),
    getWebNotificationSettings().catch(() => ({
      data: null,
      errorMessage: "Unable to load notification settings right now.",
    })),
  ]);
  const preferences = state.preferences;

  return (
    <div className="flex flex-col gap-6">
      {state.errorMessage ? (
        <div role="alert" className="feedback-block feedback-block-error">
          {state.errorMessage} The defaults are shown; saving replaces the stored values.
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Light, Dark or System, and motion.</CardDescription>
        </CardHeader>
        <CardContent>
          <AppearanceSettings
            preferences={preferences}
            action={updateAppearancePreferencesAction}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Workspace defaults</CardTitle>
          <CardDescription>
            Launch page and how task views open.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WorkspaceDefaultsForm
            preferences={preferences}
            action={updateWorkspacePreferencesAction}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Work targets</CardTitle>
          <CardDescription>
            Daily work and job-search targets used by Today and reviews.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WorkTargetsForm
            personalOperations={preferences.personalOperations}
            action={updateWorkTargetsAction}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
          <CardDescription>
            Choose which categories reach each channel and when quiet hours apply.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {preferencesResult.data ? (
            <NotificationPreferencesPanel
              preferences={preferencesResult.data}
              settings={settingsResult.data}
              timezone={timeContext?.timezone ?? null}
            />
          ) : (
            <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
              {preferencesResult.errorMessage ?? "Notification preferences unavailable right now."}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

async function IntegrationsTab({
  error,
  errorCode,
}: {
  error: string | null;
  errorCode?: GoogleCalendarOAuthFailureCode;
}) {
  const [calendar, agents] = await Promise.all([
    getCalendarIntegrationSettings(),
    listAgentRegistry(),
  ]);
  const calendarError =
    getGoogleCalendarOAuthFailureMessage(errorCode, error ?? undefined) ??
    calendar.errorMessage;
  const extraError = calendarError && calendarError !== error ? calendarError : null;

  return (
    <div className="flex flex-col gap-4">
      {extraError ? (
        <div role="alert" className="feedback-block feedback-block-error">
          {extraError}
        </div>
      ) : null}
      <IntegrationsSettings calendar={calendar.data} agents={agents} />
    </div>
  );
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  await requireSettingsPageUser(SETTINGS_PATH);

  const params = await searchParams;
  const tab = parseSettingsTab(params.tab);
  const success = feedbackMessage(params.success);
  const error = feedbackMessage(params.error);

  const content =
    tab === "preferences" ? (
      <PreferencesTab />
    ) : tab === "integrations" ? (
      <IntegrationsTab error={error} errorCode={params.errorCode} />
    ) : (
      <AccountTab />
    );

  return (
    <>
      <WorkspacePageHeader
        title="Settings"
        description="Account, preferences, notifications and integrations."
        actions={<ShortcutHelpButton />}
      />
      <div className="flex w-full min-w-0 flex-col gap-6 pb-8">
        <SettingsTabs active={tab} />
        <Feedback success={success} error={error} />
        {content}
      </div>
    </>
  );
}
