"use client";

import { getNotificationTypePolicy } from "@ega/application";
import { NOTIFICATION_TYPE_VALUES, type NotificationPreferences, type NotificationSettings, type NotificationType } from "@ega/contracts";

import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { Input } from "@/components/ui/input";
import { saveNotificationPreferenceAction, saveNotificationSettingsAction } from "./actions";

const CATEGORY_ORDER = ["task", "timer", "routine", "money", "review", "job_search"] as const;
type Category = (typeof CATEGORY_ORDER)[number];

const CATEGORY_LABELS: Record<Category, string> = {
  task: "Tasks",
  timer: "Timer",
  routine: "Routine",
  money: "Money",
  review: "Review",
  job_search: "Job search",
};

function humanizeType(type: NotificationType): string {
  return type.replaceAll("_", " ");
}

type Props = {
  preferences: NotificationPreferences[];
  settings: NotificationSettings | null;
  timezone: string | null;
};

/**
 * Per-category/per-channel preferences and quiet hours (PO-19, issue #357).
 * Every toggle maps to the canonical preference store enforced at dispatch —
 * this is not local-only UI state. Quiet hours use the account IANA timezone
 * and may cross midnight.
 */
export function NotificationPreferencesPanel({ preferences, settings, timezone }: Props) {
  const byType = new Map(preferences.map((p) => [p.notificationType, p]));

  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    types: NOTIFICATION_TYPE_VALUES.filter(
      (type) => getNotificationTypePolicy(type).category === category,
    ),
  })).filter((group) => group.types.length > 0);

  return (
    <section aria-labelledby="notification-prefs-heading" className="flex flex-col gap-4">
      <h3 id="notification-prefs-heading" className="text-[length:var(--text-section)] font-semibold">
        Notification preferences
      </h3>
      <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
        Changes persist to your account and affect all devices. Money previews stay generic on lock screens.
      </p>

      {grouped.map((group) => (
        <fieldset key={group.category} className="flex flex-col gap-2">
          <legend className="form-label">{CATEGORY_LABELS[group.category]}</legend>
          {group.types.map((type) => {
            const pref = byType.get(type);
            return (
              <form
                key={type}
                action={saveNotificationPreferenceAction}
                className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-[var(--radius-md)] border border-[var(--ega-border)] p-3"
              >
                <input type="hidden" name="notificationType" value={type} />
                <span className="min-w-36 text-[length:var(--text-body)]">{humanizeType(type)}</span>
                <label className="inline-flex min-h-11 items-center gap-2">
                  <input
                    type="checkbox"
                    name="pushEnabled"
                    defaultChecked={pref?.pushEnabled ?? true}
                  />
                  Push
                </label>
                <label className="inline-flex min-h-11 items-center gap-2">
                  <input
                    type="checkbox"
                    name="emailEnabled"
                    defaultChecked={pref?.emailEnabled ?? true}
                  />
                  Email
                </label>
                <PendingSubmitButton type="submit" size="sm" pendingLabel="Saving…">
                  Save
                </PendingSubmitButton>
              </form>
            );
          })}
        </fieldset>
      ))}

      <form action={saveNotificationSettingsAction} className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--ega-border)] p-3">
        <p className="text-[length:var(--text-body)] font-medium">Quiet hours</p>
        <label className="inline-flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            name="quietHoursEnabled"
            defaultChecked={settings?.quietHoursEnabled ?? false}
          />
          Enable quiet hours
        </label>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="quiet-start" className="form-label">
              From
            </label>
            <Input
              id="quiet-start"
              name="quietHoursStart"
              type="time"
              defaultValue={settings?.quietHoursStart ?? "22:00"}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="quiet-end" className="form-label">
              Until
            </label>
            <Input
              id="quiet-end"
              name="quietHoursEnd"
              type="time"
              defaultValue={settings?.quietHoursEnd ?? "07:00"}
            />
          </div>
          <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            {timezone ? `In your time zone (${timezone}). Windows may cross midnight.` : "Uses your account time zone."}
          </p>
        </div>
        <div>
          <PendingSubmitButton type="submit" size="sm" pendingLabel="Saving…">
            Save quiet hours
          </PendingSubmitButton>
        </div>
      </form>
    </section>
  );
}
