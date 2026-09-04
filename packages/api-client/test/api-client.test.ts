import assert from "node:assert/strict";
import test from "node:test";

import { createEgaApiClient } from "../src/client";
import type { EgaApiClient } from "../src/client";
import type { FetchLike } from "../src/http";

/**
 * Controlled HTTP tests. A tiny fake fetch records every request
 * (method, URL, headers, body) and returns canned responses, so the suite
 * proves the client's wire behavior against the PR5 transport contract
 * without any network access.
 */

type CapturedRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
};

type FakeFetchOptions = {
  /** Status for the canned response. */
  status?: number;
  /** JSON body for the canned response. */
  body?: unknown;
  /** When set, fetch rejects with this error instead of responding. */
  networkError?: Error;
};

function makeHarness(options: FakeFetchOptions = {}) {
  const calls: CapturedRequest[] = [];
  const authErrors: string[] = [];

  const fetch: FetchLike = async (url, init) => {
    if (options.networkError) throw options.networkError;

    calls.push({
      url,
      method: init.method,
      headers: init.headers,
      body: init.body ? JSON.parse(init.body) : undefined,
    });

    return new Response(
      options.body === undefined ? null : JSON.stringify(options.body),
      {
        status: options.status ?? 200,
        headers: { "content-type": "application/json" },
      },
    );
  };

  const client = createEgaApiClient({
    baseUrl: "https://api.ega.example/",
    getAccessToken: () => "token-abc",
    onAuthError: (error) => authErrors.push(`${error.code}:${error.status}`),
    fetch: fetch as never,
  });

  return { client, calls, authErrors };
}

const PROJECTS_READ_MODEL = {
  projects: [
    {
      id: "p-1",
      name: "Launch",
      slug: "launch",
      description: null,
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      taskCount: 2,
      completedTaskCount: 1,
      progressPercent: 50,
      statusCounts: [{ status: "done", count: 1 }],
      recentTasks: [],
    },
  ],
  summary: { total: 1, active: 1, completed: 0, archived: 0 },
};

test("injects Bearer token from the token callback on every /api request", async () => {
  const { client, calls } = makeHarness({ body: PROJECTS_READ_MODEL });

  await client.projects.list();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers.Authorization, "Bearer token-abc");
});

test("health request carries no Authorization header", async () => {
  const { client, calls } = makeHarness({ body: { status: "ok" } });

  const result = await client.health();

  assert.deepEqual(result, { ok: true, data: { status: "ok" } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.ega.example/health");
  assert.equal(calls[0].headers.Authorization, undefined);
});

test("list projects builds the view query and maps the read model", async () => {
  const { client, calls } = makeHarness({ body: PROJECTS_READ_MODEL });

  const result = await client.projects.list("archived");

  assert.deepEqual(result, { ok: true, data: PROJECTS_READ_MODEL });
  assert.equal(calls[0].url, "https://api.ega.example/api/projects?view=archived");
});

test("list projects omits the query when no view is given", async () => {
  const { client, calls } = makeHarness({ body: PROJECTS_READ_MODEL });

  await client.projects.list();

  assert.equal(calls[0].url, "https://api.ega.example/api/projects");
});

test("get project by slug encodes the slug path segment", async () => {
  const { client, calls } = makeHarness({
    body: { project: { id: "p-1" }, goals: [] },
  });

  const result = await client.projects.getBySlug("my project/slug");

  assert.equal(result.ok, true);
  assert.equal(calls[0].url, "https://api.ega.example/api/projects/my%20project%2Fslug");
});

test("create project posts the contract body and maps the 201 values", async () => {
  const { client, calls } = makeHarness({
    status: 201,
    body: { ok: true, values: { name: "Launch", slug: "launch", description: "" } },
  });

  const result = await client.projects.create({
    name: "Launch",
    slug: "launch",
    description: null,
  });

  assert.deepEqual(result, {
    ok: true,
    data: { ok: true, values: { name: "Launch", slug: "launch", description: "" } },
  });
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, "https://api.ega.example/api/projects");
  assert.deepEqual(calls[0].body, { name: "Launch", slug: "launch", description: null });
  assert.equal(calls[0].headers["Content-Type"], "application/json");
});

test("update project status patches the id path with the status body", async () => {
  const { client, calls } = makeHarness({ body: { ok: true } });

  const result = await client.projects.updateStatus("p-1", "done");

  assert.deepEqual(result, { ok: true, data: { ok: true } });
  assert.equal(calls[0].method, "PATCH");
  assert.equal(calls[0].url, "https://api.ega.example/api/projects/p-1/status");
  assert.deepEqual(calls[0].body, { status: "done" });
});

test("archive and unarchive project post to the action endpoints", async () => {
  const { client, calls } = makeHarness({ body: { ok: true } });

  await client.projects.archive("p-1");
  await client.projects.unarchive("p-1");

  assert.deepEqual(
    calls.map((call) => [call.method, call.url]),
    [
      ["POST", "https://api.ega.example/api/projects/p-1/archive"],
      ["POST", "https://api.ega.example/api/projects/p-1/unarchive"],
    ],
  );
  assert.equal(calls[0].body, undefined);
});

test("remove project deletes the encoded id path without a body", async () => {
  const { client, calls } = makeHarness({ body: { ok: true } });

  const result = await client.projects.remove("my project/1");

  assert.deepEqual(result, { ok: true, data: { ok: true } });
  assert.equal(calls[0].method, "DELETE");
  assert.equal(calls[0].url, "https://api.ega.example/api/projects/my%20project%2F1");
  assert.equal(calls[0].body, undefined);
});

test("remove project preserves the 409 dependency conflict status and code", async () => {
  const { client } = makeHarness({
    status: 409,
    body: {
      error: {
        code: "VALIDATION",
        message: "This project still has linked tasks. Move or remove them before permanently deleting the project.",
      },
    },
  });

  const result = await client.projects.remove("p-1");

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "VALIDATION",
      message: "This project still has linked tasks. Move or remove them before permanently deleting the project.",
      status: 409,
    },
  });
});

test("get purge preview builds the encoded preview path", async () => {
  const preview = {
    projectId: "p-1",
    projectName: "Stage CGI",
    impact: {
      taskCount: 2,
      goalCount: 1,
      sessionCount: 3,
      activeSessionCount: 0,
      reminderCount: 1,
      recurrenceCount: 0,
      externalRefCount: 0,
      taskNotificationCount: 1,
      calendarEventCount: 1,
    },
  };
  const { client, calls } = makeHarness({ body: preview });

  const result = await client.projects.getPurgePreview("my project/1");

  assert.deepEqual(result, { ok: true, data: preview });
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].url, "https://api.ega.example/api/projects/my%20project%2F1/purge-preview");
  assert.equal(calls[0].body, undefined);
});

test("purge posts the confirmation payload and maps the deleted summary", async () => {
  const deleted = {
    tasksDeleted: 2,
    goalsDeleted: 1,
    sessionsDeleted: 3,
    externalRefsDeleted: 0,
    notificationsDeleted: 1,
    calendarDeleteJobsEnqueued: 1,
  };
  const { client, calls } = makeHarness({ body: { ok: true, deleted } });

  const result = await client.projects.purge("p-1", {
    confirmationName: "Stage CGI",
    expectedTaskCount: 2,
    expectedGoalCount: 1,
  });

  assert.deepEqual(result, { ok: true, data: { ok: true, deleted } });
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, "https://api.ega.example/api/projects/p-1/purge");
  assert.deepEqual(calls[0].body, {
    confirmationName: "Stage CGI",
    expectedTaskCount: 2,
    expectedGoalCount: 1,
  });
  assert.ok(!("ownerUserId" in (calls[0].body as Record<string, unknown>)));
});

test("purge preserves the 409 contents-changed status and code", async () => {
  const { client } = makeHarness({
    status: 409,
    body: {
      error: {
        code: "VALIDATION",
        message: "Project contents changed. Review the deletion impact and confirm again.",
      },
    },
  });

  const result = await client.projects.purge("p-1", {
    confirmationName: "Stage CGI",
    expectedTaskCount: 2,
    expectedGoalCount: 1,
  });

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "VALIDATION",
      message: "Project contents changed. Review the deletion impact and confirm again.",
      status: 409,
    },
  });
});

test("remove project maps 400 and 404 envelopes", async () => {
  const notArchived = makeHarness({
    status: 400,
    body: { error: { code: "VALIDATION", message: "Only archived projects can be permanently deleted." } },
  });
  assert.deepEqual(await notArchived.client.projects.remove("p-1"), {
    ok: false,
    error: {
      code: "VALIDATION",
      message: "Only archived projects can be permanently deleted.",
      status: 400,
    },
  });

  const missing = makeHarness({
    status: 404,
    body: { error: { code: "NOT_FOUND", message: "Project not found." } },
  });
  assert.deepEqual(await missing.client.projects.remove("p-1"), {
    ok: false,
    error: { code: "NOT_FOUND", message: "Project not found.", status: 404 },
  });
});

test("list goals builds the view query and maps the read model", async () => {
  const goalsModel = {
    projects: [{ id: "p-1", name: "Launch" }],
    goals: [
      {
        id: "g-1",
        title: "Ship beta",
        description: null,
        nextStep: null,
        health: "on_track",
        status: "active",
        updatedAt: "2026-01-02T00:00:00.000Z",
        projectName: "Launch",
        linkedTasks: [],
        progressPercent: 0,
      },
    ],
    summary: { total: 1, active: 1, completed: 0, archived: 0 },
  };
  const { client, calls } = makeHarness({ body: goalsModel });

  const result = await client.goals.list("all");

  assert.deepEqual(result, { ok: true, data: goalsModel });
  assert.equal(calls[0].url, "https://api.ega.example/api/goals?view=all");
});

test("create goal posts the contract body and maps the 201 values", async () => {
  const { client, calls } = makeHarness({
    status: 201,
    body: {
      ok: true,
      values: {
        title: "Ship beta",
        projectId: "p-1",
        description: "",
        nextStep: "",
        health: "on_track",
        status: "active",
        slug: "ship-beta",
      },
    },
  });

  const result = await client.goals.create({
    title: "Ship beta",
    projectId: "p-1",
    description: null,
    nextStep: null,
    health: "on_track",
    status: "active",
    slug: "ship-beta",
  });

  assert.equal(result.ok, true);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, "https://api.ega.example/api/goals");
  assert.deepEqual(calls[0].body, {
    title: "Ship beta",
    projectId: "p-1",
    description: null,
    nextStep: null,
    health: "on_track",
    status: "active",
    slug: "ship-beta",
  });
});

test("goal updates patch the correct sub-resource with the correct body", async () => {
  const { client, calls } = makeHarness({ body: { ok: true } });

  await client.goals.updateStatus("g-1", "paused");
  await client.goals.updateHealth("g-1", "at_risk");
  await client.goals.updateHealth("g-1", null);
  await client.goals.updateNextStep("g-1", "Write the release notes");
  await client.goals.updateNextStep("g-1", null);

  assert.deepEqual(
    calls.map((call) => [call.method, call.url, call.body]),
    [
      ["PATCH", "https://api.ega.example/api/goals/g-1/status", { status: "paused" }],
      ["PATCH", "https://api.ega.example/api/goals/g-1/health", { health: "at_risk" }],
      ["PATCH", "https://api.ega.example/api/goals/g-1/health", { health: null }],
      [
        "PATCH",
        "https://api.ega.example/api/goals/g-1/next-step",
        { nextStep: "Write the release notes" },
      ],
      ["PATCH", "https://api.ega.example/api/goals/g-1/next-step", { nextStep: null }],
    ],
  );
});

test("goal archive and unarchive post to the action endpoints", async () => {
  const { client, calls } = makeHarness({ body: { ok: true } });

  await client.goals.archive("g-1");
  await client.goals.unarchive("g-1");

  assert.deepEqual(
    calls.map((call) => [call.method, call.url]),
    [
      ["POST", "https://api.ega.example/api/goals/g-1/archive"],
      ["POST", "https://api.ega.example/api/goals/g-1/unarchive"],
    ],
  );
});

test("maps the UNAUTHENTICATED envelope and fires onAuthError", async () => {
  const { client, calls, authErrors } = makeHarness({
    status: 401,
    body: { error: { code: "UNAUTHENTICATED", message: "Authentication required." } },
  });

  const result = await client.projects.list();

  assert.deepEqual(result, {
    ok: false,
    error: { code: "UNAUTHENTICATED", message: "Authentication required.", status: 401 },
  });
  assert.deepEqual(authErrors, ["UNAUTHENTICATED:401"]);
  assert.equal(calls.length, 1);
});

test("maps the VALIDATION envelope from a 400 create response", async () => {
  const { client } = makeHarness({
    status: 400,
    body: { error: { code: "VALIDATION", message: "Slug is required." } },
  });

  const result = await client.projects.create({
    name: "Launch",
    slug: "",
    description: null,
  });

  assert.deepEqual(result, {
    ok: false,
    error: { code: "VALIDATION", message: "Slug is required.", status: 400 },
  });
});

test("maps the NOT_FOUND envelope from a missing project", async () => {
  const { client } = makeHarness({
    status: 404,
    body: { error: { code: "NOT_FOUND", message: "Project not found." } },
  });

  const result = await client.projects.getBySlug("nope");

  assert.deepEqual(result, {
    ok: false,
    error: { code: "NOT_FOUND", message: "Project not found.", status: 404 },
  });
});

test("falls back to the status-derived code when the envelope is malformed", async () => {
  const { client } = makeHarness({ status: 500, body: "boom" });

  const result = await client.goals.list();

  assert.deepEqual(result, {
    ok: false,
    error: { code: "INTERNAL", message: "Internal server error.", status: 500 },
  });
});

test("normalizes unknown envelope codes to INTERNAL", async () => {
  const { client } = makeHarness({
    status: 500,
    body: { error: { code: "BANANA", message: "weird" } },
  });

  const result = await client.projects.list();

  assert.deepEqual(result, {
    ok: false,
    error: { code: "INTERNAL", message: "weird", status: 500 },
  });
});

test("preserves conflict envelope codes and 409 status", async () => {
  const { client } = makeHarness({
    status: 409,
    body: { error: { code: "CONFLICT", message: "Proposal is already being applied." } },
  });

  const result = await client.projects.list();

  assert.deepEqual(result, {
    ok: false,
    error: { code: "CONFLICT", message: "Proposal is already being applied.", status: 409 },
  });
});

test("falls back to CONFLICT when a 409 envelope omits its code", async () => {
  const { client } = makeHarness({
    status: 409,
    body: { error: { message: "Proposal is already being applied." } },
  });

  const result = await client.projects.list();

  assert.deepEqual(result, {
    ok: false,
    error: { code: "CONFLICT", message: "Proposal is already being applied.", status: 409 },
  });
});

test("missing token short-circuits to UNAUTHENTICATED without fetching", async () => {
  const calls: CapturedRequest[] = [];
  const client = createEgaApiClient({
    baseUrl: "https://api.ega.example",
    getAccessToken: async () => null,
    fetch: (async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
      calls.push({ url, method: init.method, headers: init.headers, body: init.body });
      return new Response(null, { status: 200 });
    }) as never,
  });

  const result = await client.projects.list();

  assert.deepEqual(result, {
    ok: false,
    error: { code: "UNAUTHENTICATED", message: "Authentication required.", status: 401 },
  });
  assert.equal(calls.length, 0);
});

test("network failures map to INTERNAL", async () => {
  const { client } = makeHarness({
    networkError: new Error("ECONNREFUSED"),
  });

  const result = await client.projects.list();

  assert.deepEqual(result, {
    ok: false,
    error: { code: "INTERNAL", message: "Network request failed.", status: 0 },
  });
});

test("strips trailing slashes from the base URL", async () => {
  const { client, calls } = makeHarness({ body: PROJECTS_READ_MODEL });

  await client.projects.list();

  assert.equal(calls[0].url, "https://api.ega.example/api/projects");
});

test("throws no exception and reports ok:false when the token callback throws", async () => {
  const client = createEgaApiClient({
    baseUrl: "https://api.ega.example",
    getAccessToken: () => {
      throw new Error("keychain unavailable");
    },
    fetch: (() => {
      throw new Error("must not be called");
    }) as never,
  });

  const result = await client.projects.list();

  assert.deepEqual(result, {
    ok: false,
    error: { code: "UNAUTHENTICATED", message: "Authentication required.", status: 401 },
  });
});

test("client surface exposes typed projects and goals namespaces", () => {
  const { client } = makeHarness();

  const surface: EgaApiClient = client;
  assert.equal(typeof surface.health, "function");
  assert.equal(typeof surface.projects.list, "function");
  assert.equal(typeof surface.projects.getBySlug, "function");
  assert.equal(typeof surface.projects.create, "function");
  assert.equal(typeof surface.projects.updateStatus, "function");
  assert.equal(typeof surface.projects.archive, "function");
  assert.equal(typeof surface.projects.unarchive, "function");
  assert.equal(typeof surface.projects.remove, "function");
  assert.equal(typeof surface.projects.getPurgePreview, "function");
  assert.equal(typeof surface.projects.purge, "function");
  assert.equal(typeof surface.goals.list, "function");
  assert.equal(typeof surface.goals.create, "function");
  assert.equal(typeof surface.goals.updateStatus, "function");
  assert.equal(typeof surface.goals.updateHealth, "function");
  assert.equal(typeof surface.goals.updateNextStep, "function");
  assert.equal(typeof surface.goals.archive, "function");
  assert.equal(typeof surface.goals.unarchive, "function");
});
