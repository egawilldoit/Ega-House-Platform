import type { Metadata } from "next";

import {
  disconnectGoogleCalendarAction,
  updateCalendarDefaultsAction,
} from "@/app/settings/account/actions";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getCalendarIntegrationSettings } from "@/lib/services/calendar-settings-service";

export const metadata: Metadata = {
  title: "Account Settings",
  description: "Manage account-level integrations and execution defaults.",
};

type AccountSettingsPageProps = {
  searchParams: Promise<{
    success?: string;
    error?: string;
  }>;
};

export default async function AccountSettingsPage({
  searchParams,
}: AccountSettingsPageProps) {
  const [{ success, error }, settingsResult] = await Promise.all([
    searchParams,
    getCalendarIntegrationSettings(),
  ]);
  const settings = settingsResult.data;
  const feedbackError = error ?? settingsResult.errorMessage;

  return (
    <AppShell
      eyebrow="Settings"
      title="Account"
      description="Control account-level integrations used by scheduled execution."
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Google Calendar</CardTitle>
            <CardDescription>
              Connect Calendar for scheduled task sync defaults.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {feedbackError ? (
              <div role="alert" className="feedback-block feedback-block-error">
                {feedbackError}
              </div>
            ) : null}

            {success ? (
              <div className="feedback-block feedback-block-success">
                {success}
              </div>
            ) : null}

            <div className="ega-glass-soft rounded-[1rem] p-4">
              <p className="glass-label text-etch">Connection</p>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-[color:var(--foreground)]">
                    {settings.connected ? "Connected" : "Disconnected"}
                  </p>
                  <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                    {settings.googleAccountEmail ?? "No Google account connected."}
                  </p>
                </div>
                {settings.connected ? (
                  <form action={disconnectGoogleCalendarAction}>
                    <Button type="submit" variant="danger" size="sm">
                      Disconnect
                    </Button>
                  </form>
                ) : (
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
            </div>

            <form action={updateCalendarDefaultsAction} className="space-y-4">
              <div className="ega-glass-soft rounded-[1rem] p-4">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    name="scheduledTaskSyncEnabled"
                    defaultChecked={settings.scheduledTaskSyncEnabled}
                    className="mt-1 h-4 w-4"
                  />
                  <span>
                    <span className="glass-label text-etch">
                      Default scheduled tasks to Calendar sync
                    </span>
                    <span className="mt-1 block text-xs text-[color:var(--muted-foreground)]">
                      Applies only when Calendar is connected and a task has a schedule block.
                    </span>
                  </span>
                </label>
              </div>

              <div className="space-y-2">
                <label htmlFor="defaultReminderMinutes" className="glass-label text-etch">
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
                  className="ega-glass-input h-10 rounded-xl"
                />
              </div>

              <Button type="submit">Save Calendar defaults</Button>
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
          <CardContent className="space-y-3 text-sm text-[color:var(--muted-foreground)]">
            <div className="flex items-center justify-between gap-3">
              <span>Calendar sync default</span>
              <span className="font-medium text-[color:var(--foreground)]">
                {settings.connected && settings.scheduledTaskSyncEnabled ? "On" : "Off"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Reminder</span>
              <span className="font-medium text-[color:var(--foreground)]">
                {settings.defaultReminderMinutes} minutes
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
