import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { buildWorkspaceShellMetrics } from "@/lib/workspace-shell";

import { TopBar } from "./top-bar";

test("wires Apps entry to the launcher route", () => {
  const metrics = buildWorkspaceShellMetrics({
    hasActiveTimer: false,
    blockedTaskCount: 0,
    overdueTaskCount: 0,
    dueTodayTaskCount: 0,
    hasCurrentWeekReview: true,
  });

  const markup = renderToStaticMarkup(<TopBar metrics={metrics} />);

  assert.match(markup, /href="\/apps"/);
  assert.match(markup, />Apps</);
});

test("renders a discoverable shortcuts affordance in the top bar", () => {
  const metrics = buildWorkspaceShellMetrics({
    hasActiveTimer: false,
    blockedTaskCount: 0,
    overdueTaskCount: 0,
    dueTodayTaskCount: 0,
    hasCurrentWeekReview: true,
  });

  const markup = renderToStaticMarkup(<TopBar metrics={metrics} />);

  assert.match(markup, /Open keyboard shortcuts/);
  assert.match(markup, />Shortcuts</);
});

test("renders an unread notification affordance in the top bar", () => {
  const metrics = buildWorkspaceShellMetrics({
    hasActiveTimer: false,
    blockedTaskCount: 0,
    overdueTaskCount: 0,
    dueTodayTaskCount: 0,
    hasCurrentWeekReview: true,
    unreadNotificationCount: 2,
  });

  const markup = renderToStaticMarkup(<TopBar metrics={metrics} />);

  assert.match(markup, /href="\/notifications"/);
  assert.match(markup, /Notifications \(2 unread\)/);
  assert.match(markup, /workspace-notification-signal/);
});
