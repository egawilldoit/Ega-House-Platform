import { WorkspacePageHeader } from "@/components/layout/workspace-page-header";
import type { Metadata } from "next";

import {
  disconnectGoogleCalendarAction,
  updateCalendarDefaultsAction,
} from "@/app/(workspace)/settings/account/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { getCalendarIntegrationSettings } from "@/lib/services/calendar-settings-service";
import { getWebTimeContext } from "@/lib/services/time-context-service";
import {
  type GoogleCalendarOAuthFailureCode,
  getGoogleCalendarOAuthFailureMessage,
} from "@/app/api/integrations/google-calendar/oauth";
import { TimezoneCard } from "@/app/(workspace)/settings/account/timezone-card";
import { SettingsNav } from "@/app/(workspace)/settings/_components/settings-nav";

export const metadata: Metadata = {
  title: "Account Settings",
  description: "Manage account-level integrations and execution defaults.",
};

type AccountSettingsPageProps = {
  searchParams: Promise<{
    success?: string;
    error?: string;
    errorCode?: GoogleCalendarOAuthFailureCode;
  }>;
};

export default async function AccountSettingsPage({
  searchParams,
}: AccountSettingsPageProps) {
  const [{ success, error, errorCode }, settingsResult, timeContext] =
    await Promise.all([
      searchParams,
      getCalendarIntegrationSettings(),
      getWebTimeContext(),
    ]);
  const settings = settingsResult.data;
  const feedbackError =
    getGoogleCalendarOAuthFailureMessage(errorCode, error) ??
    settingsResult.errorMessage;

  return (
    <>
<div className="flex max-w-3xl flex-col gap-6">
        <SettingsNav active="account" />

        <TimezoneCard
          timezone={timeContext.timezone}
          persistedTimezone={timeContext.persistedTimezone}
          fallback={timeContext.fallback}
        />

        <Card>
          <CardHeader>
            <CardTitle>Google Calendar</CardTitle>
            <CardDescription>
              Connect Calendar for scheduled task sync defaults.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {feedbackError ? (
              <div role="alert" className="feedback-block feedback-block-error">
                {feedbackError}
              </div>
            ) : null}

            {success ? (
              <div role="status" className="feedback-block feedback-block-success">
                {success}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <Badge tone={settings.connected ? "active" : "muted"}>
                  {settings.connected ? "Connected" : "Disconnected"}
                </Badge>
                <p className="min-w-0 truncate text-[length:var(--text-body)] text-ega-text-secondary">
                  {settings.googleAccountEmail ?? "No Google account connected."}
                </p>
              </div>
              {settings.connected ? null : (
                <form
                  action="/api/integrations/google-calendar/connect"
                  method="get"
                >
                  <Button type="submit" size="sm">
                    Connect Google Calendar
                  </Button>
                </form>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Calendar defaults</CardTitle>
            <CardDescription>
              Defaults applied to task scheduling forms.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={updateCalendarDefaultsAction} className="flex flex-col gap-5">
              <div className="flex items-start gap-3">
                <input
                  id="scheduledTaskSyncEnabled"
                  type="checkbox"
                  name="scheduledTaskSyncEnabled"
                  defaultChecked={settings.scheduledTaskSyncEnabled}
                  disabled={!settings.connected}
                  aria-describedby="scheduledTaskSyncEnabled-help"
                  className="mt-0.5 h-4 w-4 accent-[var(--ega-ink)] disabled:cursor-not-allowed disabled:opacity-50"
                />
                <div className="min-w-0">
                  <label
                    htmlFor="scheduledTaskSyncEnabled"
                    className="block text-[length:var(--text-body)] font-medium text-ega-text"
                  >
                    Default scheduled tasks to Calendar sync
                  </label>
                  <p
                    id="scheduledTaskSyncEnabled-help"
                    className="mt-1 block text-[length:var(--text-meta)] text-ega-text-secondary"
                  >
                    {settings.connected
                      ? "Applies only when Calendar is connected and a task has a schedule block."
                      : "Connect Google Calendar to enable. Applies only when Calendar is connected and a task has a schedule block."}
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label
                  htmlFor="defaultReminderMinutes"
                  className="text-[length:var(--text-body)] font-medium text-ega-text"
                >
                  Default reminder minutes
                </label>
                <Input
                  id="defaultReminderMinutes"
                  name="defaultReminderMinutes"
                  type="number"
                  min="0"
                  max="10080"
                  step="5"
                  defaultValue={settings.defaultReminderMinutes}
                  className="h-9 w-full max-w-xs"
                />
              </div>

              <div>
                <PendingSubmitButton type="submit" pendingLabel="Saving...">
                  Save Calendar defaults
                </PendingSubmitButton>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Scheduled task defaults</CardTitle>
            <CardDescription>
              Current defaults used by task scheduling forms.
            </CardDescription>
          </CardHeader>
          <dl className="rows">
            <div className="row">
              <dt className="flex-1 text-[length:var(--text-meta-lg)] text-ega-text-secondary">
                Calendar sync default
              </dt>
              <dd className="tabular-nums text-[length:var(--text-body)] font-medium text-ega-text">
                {settings.connected && settings.scheduledTaskSyncEnabled ? "On" : "Off"}
              </dd>
            </div>
            <div className="row">
              <dt className="flex-1 text-[length:var(--text-meta-lg)] text-ega-text-secondary">
                Reminder
              </dt>
              <dd className="tabular-nums text-[length:var(--text-body)] font-medium text-ega-text">
                {settings.defaultReminderMinutes} minutes
              </dd>
            </div>
          </dl>
        </Card>

        {settings.connected ? (
          <Card>
            <CardHeader>
              <CardTitle>Disconnect Google Calendar</CardTitle>
              <CardDescription>
                Remove the stored Calendar connection and turn off Calendar sync defaults.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form action={disconnectGoogleCalendarAction}>
                <PendingSubmitButton
                  type="submit"
                  variant="danger"
                  size="sm"
                  pendingLabel="Disconnecting..."
                >
                  Disconnect
                </PendingSubmitButton>
              </form>
            </CardContent>
          </Card>
        ) : null}
      </div>
</>
  );
}
