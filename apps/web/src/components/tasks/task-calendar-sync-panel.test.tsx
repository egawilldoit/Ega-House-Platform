import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { CalendarSyncStatusView } from "@ega/application/calendar-sync/service";

import { TaskCalendarSyncPanel } from "./task-calendar-sync-panel";

function status(
  overrides: Partial<CalendarSyncStatusView> = {},
): CalendarSyncStatusView {
  return {
    connection: {
      connected: true,
      needsReconnect: false,
      accountEmail: "owner@example.com",
      calendarId: "primary",
      destinationKey: "google-subject-1|primary",
    },
    run: {
      id: "run-1",
      status: "completed",
      retryMode: false,
      scanComplete: true,
      counts: {
        total: 6,
        created: 2,
        updated: 1,
        removed: 1,
        unchanged: 1,
        excluded: 1,
        failed: 0,
        pending: 0,
        retrying: 0,
        processing: 0,
        ready: 0,
      },
      exclusions: [{ reason: "deadline_only", count: 1 }],
      failures: [],
      hasMore: false,
      lastError: null,
      startedAt: "2026-05-10T08:00:00.000Z",
      completedAt: "2026-05-10T08:01:00.000Z",
    },
    pausedRun: null,
    message: null,
    continuationBlocked: false,
    ...overrides,
  };
}

test("Calendar sync panel shows connect link and no fabricated counts when disconnected", () => {
  const markup = renderToStaticMarkup(
    React.createElement(TaskCalendarSyncPanel, {
      initialStatus: status({
        connection: {
          connected: false,
          needsReconnect: false,
          accountEmail: null,
          calendarId: "primary",
          destinationKey: "unknown-account|primary",
        },
        run: null,
      }),
    }),
  );

  assert.match(markup, /Connect Google Calendar/);
  assert.match(markup, /A deadline without a planned date is not published/);
  assert.doesNotMatch(markup, /calendar-sync-counts/);
});

test("Calendar sync panel renders truthful counts and visible exclusion reasons", () => {
  const markup = renderToStaticMarkup(
    React.createElement(TaskCalendarSyncPanel, {
      initialStatus: status(),
    }),
  );

  assert.match(markup, /Synchronize/);
  assert.match(markup, /Created/);
  assert.match(markup, /Removed/);
  assert.match(markup, /Excluded/);
  assert.match(markup, /A deadline without a planned date or time block is not published/);
  assert.match(markup, /Sync continues in the background/);
});

test("Calendar sync panel surfaces reconnect and paused destination messaging", () => {
  const markup = renderToStaticMarkup(
    React.createElement(TaskCalendarSyncPanel, {
      initialStatus: status({
        connection: {
          connected: true,
          needsReconnect: true,
          accountEmail: "owner@example.com",
          calendarId: "primary",
          destinationKey: "google-subject-1|primary",
        },
        message:
          "Sync for team@example.com is paused. Events already published there remain in that calendar.",
        pausedRun: null,
      }),
    }),
  );

  assert.match(markup, /Reconnect Google Calendar/);
  assert.match(markup, /Events already published there remain in that calendar/);
  assert.match(markup, /existing events stay in Google Calendar/);
});
