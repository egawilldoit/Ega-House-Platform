import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { TodayOperatorPlan } from "./today-operator-plan";

test("TodayOperatorPlan: renders progressive disclosure summary when no proposal exists", () => {
  const html = renderToStaticMarkup(
    <TodayOperatorPlan
      tasks={[]}
      proposal={null}
      proposalError={null}
      returnTo="/today"
    />,
  );

  assert.match(html, /<details/);
  assert.match(html, /\+ Prepare approval plan from focus lane\.\.\./);
});

test("TodayOperatorPlan: renders approval controls directly when proposal exists", () => {
  const proposal = {
    id: "prop-1",
    ownerUserId: "u1",
    status: "generated",
    proposedTaskIds: [],
    createdAt: "2026-09-30T10:00:00Z",
    updatedAt: "2026-09-30T10:00:00Z",
  } as unknown as React.ComponentProps<typeof TodayOperatorPlan>["proposal"];

  const html = renderToStaticMarkup(
    <TodayOperatorPlan
      tasks={[]}
      proposal={proposal}
      proposalError={null}
      returnTo="/today"
    />,
  );

  assert.match(html, /Needs approval/);
  assert.match(html, /Approve plan/);
});
