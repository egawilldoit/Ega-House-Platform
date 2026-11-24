"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CalendarDays, RefreshCw } from "lucide-react";

import {
  CALENDAR_SYNC_EXCLUSION_LABELS,
  type CalendarSyncExclusionReason,
} from "@ega/domain";
import type {
  CalendarSyncStatusView,
} from "@ega/application/calendar-sync/service";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type SyncAction = "start" | "retry" | "continue";

type SyncResponse =
  | { ok: true; status: CalendarSyncStatusView }
  | { ok: false; error: string; reason?: string };

const CONNECT_HREF =
  "/api/integrations/google-calendar/connect?returnTo=/tasks";

function countLabel(value: number) {
  return new Intl.NumberFormat("en").format(value);
}

export function TaskCalendarSyncPanel({
  initialStatus,
}: {
  initialStatus: CalendarSyncStatusView;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState<SyncAction | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [offline, setOffline] = useState(
    () => typeof navigator !== "undefined" && !navigator.onLine,
  );
  const mountedRef = useRef(true);
  const continuingRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;

    const onOffline = () => {
      setOffline(true);
      setErrorMessage(
        "You are offline. Sync will resume from the server when recovery runs.",
      );
    };
    const onOnline = () => {
      setOffline(false);
      setErrorMessage(null);
    };

    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);

    return () => {
      mountedRef.current = false;
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  async function postAction(
    action: SyncAction,
    runId?: string,
  ): Promise<SyncResponse | null> {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setOffline(true);
      setErrorMessage(
        "You are offline. Reconnect to continue this Calendar sync.",
      );
      return null;
    }

    try {
      const response = await fetch("/api/integrations/google-calendar/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, runId }),
      });
      return (await response.json()) as SyncResponse;
    } catch {
      setErrorMessage(
        "The Calendar sync request did not reach EGA House. Check your connection and retry.",
      );
      return null;
    }
  }

  async function continueRun(runId: string) {
    if (continuingRef.current) return;
    continuingRef.current = true;

    try {
      let currentRunId: string | null = runId;
      while (mountedRef.current && currentRunId) {
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          setOffline(true);
          break;
        }

        const result = await postAction("continue", currentRunId);
        if (!result || !mountedRef.current) break;
        if (!result.ok) {
          setErrorMessage(result.error);
          break;
        }

        setStatus(result.status);
        setErrorMessage(null);
        if (result.status.continuationBlocked) break;
        if (!result.status.run?.hasMore) break;
        currentRunId = result.status.run.id;
      }
    } finally {
      continuingRef.current = false;
    }
  }

  useEffect(() => {
    const run = initialStatus.run;
    if (
      run?.hasMore &&
      run.status === "active" &&
      !initialStatus.continuationBlocked
    ) {
      void continueRun(run.id);
    }
    // The first mount rehydrates the pending run; later continuations are
    // driven by the loop above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runAction(action: "start" | "retry") {
    setBusy(action);
    setErrorMessage(null);
    try {
      const result = await postAction(action);
      if (!result) return;
      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }

      setStatus(result.status);
      const run = result.status.run;
      if (run?.hasMore && !result.status.continuationBlocked) {
        await continueRun(run.id);
      }
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  }

  const run = status.run;
  const counts = run?.counts;
  const needsReconnect = status.connection.needsReconnect;
  const connected = status.connection.connected;
  const exclusions = run?.exclusions ?? [];
  const failures = run?.failures ?? [];
  const statusReadErrors = [
    status.statusErrors.connection,
    status.statusErrors.run,
    status.statusErrors.pausedRun,
    run?.statusErrors.counts,
    run?.statusErrors.exclusions,
    run?.statusErrors.failures,
  ].filter((message): message is string => Boolean(message));

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--ega-divider)] px-[18px] py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-ega-text-secondary" aria-hidden="true" />
            <h2 className="text-[length:var(--text-body)] font-semibold text-ega-text">
              Google Calendar
            </h2>
            <Badge
              tone={
                needsReconnect
                  ? "error"
                  : connected
                    ? "active"
                    : "muted"
              }
            >
              {needsReconnect
                ? "Reconnect needed"
                : connected
                  ? "Connected"
                  : "Not connected"}
            </Badge>
          </div>
          <p className="mt-1 text-[length:var(--text-meta)] text-ega-text-secondary">
            {connected
              ? `${status.connection.accountEmail ?? "Google account"} · ${status.connection.calendarId}`
              : "Connect once, then publish eligible tasks from this page."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!connected || needsReconnect ? (
            <Link
              href={CONNECT_HREF}
              className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "gap-2")}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              {connected ? "Reconnect Google Calendar" : "Connect Google Calendar"}
            </Link>
          ) : (
            <>
              <Button
                type="button"
                size="sm"
                onClick={() => void runAction("start")}
                disabled={Boolean(busy) || offline}
              >
                {busy === "start" ? "Synchronizing…" : "Synchronize"}
              </Button>
              {counts && (counts.failed > 0 || counts.retrying > 0) ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void runAction("retry")}
                  disabled={Boolean(busy) || offline}
                >
                  {busy === "retry" ? "Retrying…" : "Retry retryable"}
                </Button>
              ) : null}
            </>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 px-[18px] py-3">
        {status.message ? (
          <p className="feedback-block" role="status">
            {status.message}
          </p>
        ) : null}

        {statusReadErrors.length > 0 ? (
          <p
            className="feedback-block"
            role="status"
            data-testid="calendar-sync-status-unavailable"
          >
            Some Calendar sync status could not be loaded:{" "}
            {statusReadErrors.join(" ")} Details shown may be incomplete.
          </p>
        ) : null}

        {needsReconnect ? (
          <p className="feedback-block" role="alert">
            Google no longer accepts the saved Calendar connection. Reconnect the
            same account to resume queued work; existing events stay in Google
            Calendar until a sync removes them.
          </p>
        ) : null}

        {errorMessage ? (
          <p className="feedback-block" role="alert" data-testid="calendar-sync-error">
            {errorMessage}
          </p>
        ) : null}

        {offline && !errorMessage ? (
          <p className="feedback-block" role="status">
            Offline. Sync will resume when the connection returns.
          </p>
        ) : null}

        {run && counts ? (
          <>
            <div
              className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4 lg:grid-cols-8"
              data-testid="calendar-sync-counts"
            >
              {[
                ["Created", counts.created],
                ["Updated", counts.updated],
                ["Removed", counts.removed],
                ["Unchanged", counts.unchanged],
                ["Excluded", counts.excluded],
                ["Pending", counts.pending],
                ["Retrying", counts.retrying],
                ["Failed", counts.failed],
              ].map(([label, value]) => (
                <div key={String(label)} className="min-w-0">
                  <dt className="text-[length:var(--text-meta)] text-ega-text-tertiary">
                    {label}
                  </dt>
                  <dd className="tabular-nums text-[length:var(--text-body)] font-medium text-ega-text">
                    {countLabel(Number(value))}
                  </dd>
                </div>
              ))}
            </div>

            <p className="text-[length:var(--text-meta)] text-ega-text-tertiary">
              {run.scanComplete
                ? "Scan complete."
                : `Scanning tasks. ${countLabel(counts.total)} accounted for so far.`}{" "}
              Sync continues in the background if you close this page.
            </p>

            {exclusions.length > 0 ? (
              <div>
                <h3 className="text-[length:var(--text-meta)] font-medium text-ega-text-secondary">
                  Excluded
                </h3>
                <ul className="mt-1 flex flex-col gap-1">
                  {exclusions.map((exclusion) => (
                    <li
                      key={exclusion.reason}
                      className="text-[length:var(--text-meta)] text-ega-text-secondary"
                    >
                      {CALENDAR_SYNC_EXCLUSION_LABELS[
                        exclusion.reason as CalendarSyncExclusionReason
                      ] ?? exclusion.reason}{" "}
                      ({countLabel(exclusion.count)})
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {failures.length > 0 ? (
              <div>
                <h3 className="text-[length:var(--text-meta)] font-medium text-ega-text-secondary">
                  Needs attention
                </h3>
                <ul className="mt-1 flex flex-col gap-1">
                  {failures.map((failure) => (
                    <li
                      key={`${failure.taskId}-${failure.message}`}
                      className="text-[length:var(--text-meta)] text-[color:var(--status-overdue)]"
                    >
                      {failure.message}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-[length:var(--text-meta)] text-ega-text-tertiary">
                  Permanent failures need the task or conflicting Google event
                  corrected before retry.
                </p>
              </div>
            ) : null}
          </>
        ) : run ? (
          <p className="text-[length:var(--text-meta)] text-ega-text-secondary">
            Run details could not be loaded. Use Synchronize to resume this sync.
          </p>
        ) : connected ? (
          <p className="text-[length:var(--text-meta)] text-ega-text-secondary">
            No Calendar sync run yet. Synchronize to publish eligible tasks and
            remove events for completed, archived, unscheduled, or opted-out tasks.
          </p>
        ) : (
          <p className="text-[length:var(--text-meta)] text-ega-text-secondary">
            A deadline without a planned date is not published. Add a planned
            date or a complete time block to include a task.
          </p>
        )}
      </div>
    </Card>
  );
}
