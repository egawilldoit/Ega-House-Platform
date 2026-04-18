import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { buildWorkspaceShellMetrics } from "@/lib/workspace-shell";

import {
  getSidebarTaskSignalBadge,
  TopBarSignalCluster,
} from "./shell-signals";

test("renders the top bar signal cluster with actionable shell signals only", () => {
  const metrics = buildWorkspaceShellMetrics({
    hasActiveTimer: true,
    blockedTaskCount: 1,
    overdueTaskCount: 2,
    dueTodayTaskCount: 3,
    hasCurrentWeekReview: false,
  });

  const markup = renderToStaticMarkup(<TopBarSignalCluster metrics={metrics} />);

  assert.match(markup, /Timer active/);
  assert.match(markup, /2 overdue/);
  assert.match(markup, /3 due today/);
  assert.match(markup, /1 blocked/);
  assert.match(markup, /Review due/);
});

test("keeps shell signal rendering clean when there is nothing actionable", () => {
  const metrics = buildWorkspaceShellMetrics({
    hasActiveTimer: false,
    blockedTaskCount: 0,
    overdueTaskCount: 0,
    dueTodayTaskCount: 0,
    hasCurrentWeekReview: true,
  });

  const markup = renderToStaticMarkup(<TopBarSignalCluster metrics={metrics} />);

  assert.equal(markup, "");
  assert.equal(getSidebarTaskSignalBadge(metrics), null);
});
