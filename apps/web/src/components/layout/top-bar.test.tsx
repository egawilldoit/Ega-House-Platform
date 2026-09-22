import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { buildWorkspaceShellMetrics } from "@/lib/workspace-shell";

import { TopBar } from "./top-bar";

const identity = { name: "EGA", email: "ega@egahouse.com", initials: "EG" };

const metrics = buildWorkspaceShellMetrics({
  hasActiveTimer: false,
  blockedTaskCount: 0,
  overdueTaskCount: 0,
  dueTodayTaskCount: 0,
  hasCurrentWeekReview: true,
});

test("renders an unread notification affordance with a stable state hook", () => {
  const markup = renderToStaticMarkup(
    <TopBar
      metrics={buildWorkspaceShellMetrics({
        hasActiveTimer: false,
        blockedTaskCount: 0,
        overdueTaskCount: 0,
        dueTodayTaskCount: 0,
        hasCurrentWeekReview: true,
        unreadNotificationCount: 2,
      })}
      identity={identity}
    />,
  );

  assert.match(markup, /href="\/notifications"/);
  assert.match(markup, /Notifications \(2 unread\)/);
  assert.match(markup, /data-has-unread="true"/);
  assert.match(markup, /notification-dot/);
});

test("keeps the notification affordance state explicit when nothing is unread", () => {
  const markup = renderToStaticMarkup(<TopBar metrics={metrics} identity={identity} />);

  assert.match(markup, /data-has-unread="false"/);
  assert.doesNotMatch(markup, /notification-dot/);
});

test("keeps the top bar restrained: account identity, no editorial pills", () => {
  const markup = renderToStaticMarkup(<TopBar metrics={metrics} identity={identity} />);

  assert.match(markup, /href="\/settings\/account"/);
  assert.match(markup, /ega@egahouse\.com/);
  assert.match(markup, /topbar-avatar/);
  // Removed editorial clutter stays removed.
  assert.doesNotMatch(markup, />Apps</);
  assert.doesNotMatch(markup, /Open keyboard shortcuts/);
  assert.doesNotMatch(markup, /route-index/);
  assert.doesNotMatch(markup, /workspace-route-meta/);
  assert.doesNotMatch(markup, /Search tasks, goals, projects/);
});
