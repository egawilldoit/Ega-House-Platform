"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { isValidIANATimeZone } from "@ega/domain/time-context";

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
import { updateAccountTimezoneAction } from "@/app/settings/account/actions";

type TimezoneCardProps = {
  /** Effective timezone actually used for day/time semantics (UTC when fallback). */
  timezone: string;
  /** Raw persisted IANA zone, or null when the owner has none stored. */
  persistedTimezone: string | null;
  fallback: "none" | "invalid_timezone" | "missing_timezone";
};

const FALLBACK_TIMEZONES = [
  "UTC",
  "Africa/Casablanca",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Tokyo",
  "Europe/Paris",
];

function detectDeviceTimezone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && isValidIANATimeZone(zone) ? zone : null;
  } catch {
    return null;
  }
}

function commonTimezones(): string[] {
  try {
    const supported = Intl.supportedValuesOf("timeZone");
    if (Array.isArray(supported) && supported.length > 0) {
      return supported.filter((zone) => !zone.startsWith("Etc/GMT"));
    }
  } catch {
    // Fall through to the static list when unsupported.
  }
  return FALLBACK_TIMEZONES;
}

export function TimezoneCard({
  timezone,
  persistedTimezone,
  fallback,
}: TimezoneCardProps) {
  const [detectedTimezone, setDetectedTimezone] = useState<string | null>(null);
  const [manualTimezone, setManualTimezone] = useState("");
  const initializedRef = useRef(false);
  const initFormRef = useRef<HTMLFormElement>(null);
  const timezoneOptions = useMemo(commonTimezones, []);

  useEffect(() => {
    setDetectedTimezone(detectDeviceTimezone());
  }, []);

  const hasPersistedTimezone = persistedTimezone !== null;
  const detectionFailed = detectedTimezone === null;
  const deviceDiffers =
    detectedTimezone !== null && detectedTimezone !== timezone;

  useEffect(() => {
    if (initializedRef.current) return;
    if (hasPersistedTimezone) return;
    if (!detectedTimezone) return;
    initializedRef.current = true;
    initFormRef.current?.requestSubmit();
  }, [hasPersistedTimezone, detectedTimezone]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Timezone</CardTitle>
        <CardDescription>
          Used for Today, Tasks, Timer, reminders, analytics and reviews.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <dl className="rows">
          <div className="row">
            <dt className="flex-1 text-[length:var(--text-meta-lg)] text-ega-text-secondary">
              EGA House timezone
            </dt>
            <dd className="flex items-center gap-2 text-[length:var(--text-body)] font-medium text-ega-text">
              <span className="tabular-nums">{timezone}</span>
              {!hasPersistedTimezone ? (
                <Badge tone="muted">default</Badge>
              ) : null}
            </dd>
          </div>
          <div className="row">
            <dt className="flex-1 text-[length:var(--text-meta-lg)] text-ega-text-secondary">
              Detected browser timezone
            </dt>
            <dd className="tabular-nums text-[length:var(--text-body)] font-medium text-ega-text">
              {detectedTimezone ?? "Unavailable"}
            </dd>
          </div>
        </dl>

        {!hasPersistedTimezone && fallback !== "none" ? (
          <p className="text-[length:var(--text-meta)] text-ega-text-secondary">
            {detectionFailed
              ? "We could not detect a valid timezone on this device, so EGA House is using UTC. Pick your timezone below."
              : "No timezone is saved yet. We can set it from this device."}
          </p>
        ) : null}

        {deviceDiffers ? (
          <form
            action={updateAccountTimezoneAction}
            className="flex flex-wrap items-center gap-3"
          >
            <input type="hidden" name="timezone" value={detectedTimezone ?? ""} />
            <input
              type="hidden"
              name="feedback"
              value={`Timezone updated to ${detectedTimezone ?? ""} based on this device.`}
            />
            <PendingSubmitButton type="submit" size="sm" pendingLabel="Saving...">
              Use device timezone ({detectedTimezone})
            </PendingSubmitButton>
          </form>
        ) : null}

        <form action={updateAccountTimezoneAction} className="flex flex-col gap-3">
          <label
            htmlFor="account-timezone"
            className="text-[length:var(--text-body)] font-medium text-ega-text"
          >
            Set timezone manually
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Input
              id="account-timezone"
              name="timezone"
              list="iana-timezone-options"
              placeholder="e.g. Africa/Casablanca"
              value={manualTimezone}
              onChange={(event) => setManualTimezone(event.target.value)}
              className="h-9 w-full max-w-xs"
            />
            <datalist id="iana-timezone-options">
              {timezoneOptions.map((zone) => (
                <option key={zone} value={zone} />
              ))}
            </datalist>
            <PendingSubmitButton
              type="submit"
              size="sm"
              pendingLabel="Saving..."
              disabled={!manualTimezone.trim()}
            >
              Update timezone
            </PendingSubmitButton>
          </div>
          <p className="text-[length:var(--text-meta)] text-ega-text-secondary">
            Enter any IANA timezone name. Invalid names are rejected.
          </p>
        </form>

        {!hasPersistedTimezone && detectedTimezone ? (
          <form
            ref={initFormRef}
            action={updateAccountTimezoneAction}
            className="hidden"
            aria-hidden="true"
          >
            <input type="hidden" name="timezone" value={detectedTimezone} />
            <input
              type="hidden"
              name="feedback"
              value={`We set your EGA House timezone to ${detectedTimezone} based on this device.`}
            />
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
