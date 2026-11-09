import assert from "node:assert/strict";
import test from "node:test";
import { beforeEach, vi } from "vitest";

vi.mock("@/lib/services/morning-startup-service", () => ({
  startMorningOutcomes: vi.fn(),
}));
vi.mock("@/lib/services/auth-service", () => ({
  getCurrentUser: vi.fn(),
}));
vi.mock("@/lib/services/time-context-service", () => ({
  getWebTimeContext: vi.fn(),
}));
vi.mock("@/lib/workspace/workspace-navigation", () => ({
  redirectWithWorkspaceFeedback: vi.fn(),
  revalidateWorkspaceFor: vi.fn(),
}));

import {
  MORNING_OUTCOME_EMPTY_MESSAGE,
  MORNING_OUTCOME_LIMIT_MESSAGE,
} from "@/lib/morning-startup";
import { startMorningOutcomes } from "@/lib/services/morning-startup-service";
import { getCurrentUser } from "@/lib/services/auth-service";
import { getWebTimeContext } from "@/lib/services/time-context-service";
import {
  redirectWithWorkspaceFeedback,
  revalidateWorkspaceFor,
} from "@/lib/workspace/workspace-navigation";

import { startMorningOutcomesAction } from "./startup-actions";

const REDIRECT_SENTINEL = new Error("redirect");
const GENERIC_SAVE_ERROR =
  "Morning startup could not be saved right now. Try again from Today.";

function formData(entries: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    if (Array.isArray(value)) {
      for (const item of value) data.append(key, item);
    } else {
      data.append(key, value);
    }
  }
  return data;
}

function selection(ids: string[], returnTo = "/today"): FormData {
  return formData({ returnTo, taskIds: ids });
}

async function run(form: FormData) {
  try {
    await startMorningOutcomesAction(form);
  } catch (error) {
    if (error !== REDIRECT_SENTINEL) throw error;
  }
}

function lastRedirect(): [string, Record<string, unknown> | undefined] {
  const calls = vi.mocked(redirectWithWorkspaceFeedback).mock.calls;
  assert.ok(calls.length > 0, "expected a redirect");
  return calls[calls.length - 1] as [string, Record<string, unknown> | undefined];
}

function revalidationCalls() {
  return vi.mocked(revalidateWorkspaceFor).mock.calls;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentUser).mockResolvedValue({ id: "user-1" } as never);
  vi.mocked(getWebTimeContext).mockResolvedValue({
    localDate: "2026-11-07",
  } as never);
  vi.mocked(redirectWithWorkspaceFeedback).mockImplementation(() => {
    throw REDIRECT_SENTINEL;
  });
  vi.mocked(revalidateWorkspaceFor).mockImplementation(() => {});
});

test("invalid empty selection redirects with an error, no success and no retry state", async () => {
  await run(selection([]));

  const [target, feedback] = lastRedirect();
  assert.equal(target, "/today");
  assert.deepEqual(feedback, { errorMessage: MORNING_OUTCOME_EMPTY_MESSAGE });
  assert.equal("successMessage" in (feedback ?? {}), false);
  assert.doesNotMatch(target, /startupRetry/);
  assert.equal(vi.mocked(startMorningOutcomes).mock.calls.length, 0);
  assert.deepEqual(revalidationCalls()[0], ["today", { returnTo: "/today" }]);
});

test("over-limit selection preserves sanitised retry ids on the error redirect", async () => {
  await run(selection(["a", "b", "c", "d", "bad id", "../x"]));

  const [target, feedback] = lastRedirect();
  assert.equal(target, "/today?startupRetry=a%2Cb%2Cc%2Cd");
  assert.deepEqual(feedback, { errorMessage: MORNING_OUTCOME_LIMIT_MESSAGE });
  assert.equal("successMessage" in (feedback ?? {}), false);
  assert.equal(vi.mocked(startMorningOutcomes).mock.calls.length, 0);
  assert.deepEqual(revalidationCalls()[0], ["today", { returnTo: "/today" }]);
});

test("service error redirects with the error only and revalidates", async () => {
  vi.mocked(startMorningOutcomes).mockResolvedValue({
    errorMessage: "Unable to update task right now.",
    appliedCount: 1,
  });

  await run(selection(["a"]));

  const [target, feedback] = lastRedirect();
  assert.equal(target, "/today?startupRetry=a");
  assert.deepEqual(feedback, { errorMessage: "Unable to update task right now." });
  assert.equal("successMessage" in (feedback ?? {}), false);
  assert.deepEqual(revalidationCalls()[0], ["today", { returnTo: "/today" }]);
});

test("thrown service error becomes an actionable generic error with no success", async () => {
  vi.mocked(startMorningOutcomes).mockRejectedValue(new Error("boom"));

  await run(selection(["a"]));

  const [target, feedback] = lastRedirect();
  assert.equal(target, "/today?startupRetry=a");
  assert.deepEqual(feedback, { errorMessage: GENERIC_SAVE_ERROR });
  assert.equal("successMessage" in (feedback ?? {}), false);
  assert.deepEqual(revalidationCalls()[0], ["today", { returnTo: "/today" }]);
});

test("success redirects with singular helper text and no retry state", async () => {
  vi.mocked(startMorningOutcomes).mockResolvedValue({
    errorMessage: null,
    appliedCount: 1,
  });

  await run(selection(["a"]));

  const [target, feedback] = lastRedirect();
  assert.equal(target, "/today");
  assert.deepEqual(feedback, {
    successMessage: "Morning startup saved: 1 outcome for today.",
  });
  assert.equal("errorMessage" in (feedback ?? {}), false);
  assert.doesNotMatch(target, /startupRetry/);
  assert.deepEqual(revalidationCalls()[0], ["today", { returnTo: "/today" }]);
});

test("success redirects with plural helper text for multiple outcomes", async () => {
  vi.mocked(startMorningOutcomes).mockResolvedValue({
    errorMessage: null,
    appliedCount: 2,
  });

  await run(selection(["a", "b"]));

  const [target, feedback] = lastRedirect();
  assert.equal(target, "/today");
  assert.deepEqual(feedback, {
    successMessage: "Morning startup saved: 2 outcomes for today.",
  });
  assert.equal("errorMessage" in (feedback ?? {}), false);
  assert.doesNotMatch(target, /startupRetry/);
  assert.deepEqual(revalidationCalls()[0], ["today", { returnTo: "/today" }]);
});

test("unauthenticated redirects with the sign-in error and does not call the service", async () => {
  vi.mocked(getCurrentUser).mockResolvedValue(null);

  await run(selection(["a"]));

  const [target, feedback] = lastRedirect();
  assert.equal(target, "/today?startupRetry=a");
  assert.deepEqual(feedback, { errorMessage: "Sign in to start your day." });
  assert.equal("successMessage" in (feedback ?? {}), false);
  assert.equal(vi.mocked(startMorningOutcomes).mock.calls.length, 0);
  assert.deepEqual(revalidationCalls()[0], ["today", { returnTo: "/today" }]);
});
