import { expect, test, ownerClient } from "./disposable-fixtures";
import type { Request } from "@playwright/test";

import { getPwaOwners, signInPwaOwner } from "./pwa-fixtures";

test("owner starts the day with known outcomes, recovers a timer and saves its outcome", async ({ page, owners }) => {

  const { ownerA } = getPwaOwners();
  const client = await ownerClient(owners.ownerA);
  const project = await client.from("projects").select("id").single();
  expect(project.error).toBeNull();
  if (!project.data) throw new Error("Fixture project is missing.");
  const seeded = await client.from("tasks").insert([
    { project_id: project.data.id, owner_user_id: owners.ownerA.id, title: "E2E startup outcome A", status: "todo", priority: "high", focus_rank: 1 },
    { project_id: project.data.id, owner_user_id: owners.ownerA.id, title: "E2E startup outcome B", status: "todo", priority: "high", focus_rank: 2 },
  ]);
  expect(seeded.error).toBeNull();
  await signInPwaOwner(page, ownerA, "/today");

  await expect(page.getByTestId("morning-startup")).toBeVisible();

  const group = page.locator('[data-testid^="morning-startup-group-"]').first();
  await expect(group).toBeVisible();

  const checkboxes = group.getByRole("checkbox");
  const checkboxCount = await checkboxes.count();

  const selectionCount = 2;
  expect(checkboxCount).toBe(2);
  const selectedTitles: string[] = [];
  const selectedIds: string[] = [];

  for (let index = 0; index < selectionCount; index += 1) {
    const checkbox = checkboxes.nth(index);
    selectedIds.push(await checkbox.inputValue());
    const inputId = await checkbox.getAttribute("id");
    expect(inputId).toBeTruthy();
    const label = group.locator(`label[for="${inputId}"]`);
    const labelText = (await label.innerText()).trim();
    selectedTitles.push(labelText.split("·")[0]?.trim() ?? labelText);
    await checkbox.check();
  }

  await group.getByRole("button", { name: /^Start with / }).click();
  await expect(
    page.getByText(
      "Morning startup saved: 2 outcomes for today.",
    ),
  ).toBeVisible();

  await page.reload();
  const planned = page.getByTestId("morning-startup-planned");
  await expect(planned).toBeVisible();
  for (const title of selectedTitles) {
    await expect(planned.getByText(title, { exact: false })).toBeVisible();
  }

  const startTimer = page.locator("form")
    .filter({ has: page.locator('input[name="taskId"]').and(page.locator(`input[value="${selectedIds[0]}"]`)) })
    .getByRole("button", { name: /^Start timer$/ }).first();
  await expect(startTimer).toBeVisible();
  await startTimer.click();

  const stopTimer = page.getByRole("button", { name: /^Stop timer$/ }).first();
  await expect(stopTimer).toBeVisible({ timeout: 20_000 });
  const active = await client.from("task_sessions").select("id").is("ended_at", null).single();
  expect(active.error).toBeNull();
  await page.reload();
  await expect(stopTimer).toBeVisible({ timeout: 20_000 });
  const recovered = await client.from("task_sessions").select("id").is("ended_at", null).single();
  expect(recovered.error).toBeNull();
  expect(recovered.data).toEqual(active.data);
  await stopTimer.click();
  await expect(page.getByText("Timer stopped", { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("radio", { name: /No status change/ }).check();
  await page.getByRole("button", { name: "Save outcome", exact: true }).click();
  await expect(page.getByText("Timer stopped. Task status unchanged.", { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.reload();
  await expect(stopTimer).toHaveCount(0);
  const sessions = await client.from("task_sessions").select("id,ended_at");
  expect(sessions.error).toBeNull();
  expect(sessions.data).toHaveLength(1);
  expect(sessions.data?.[0].id).toBe(active.data?.id);
  expect(sessions.data?.[0].ended_at).toBeTruthy();
});

test("two timer clients reconcile a competing start and safely retry an old stop", async ({ page, context, owners }) => {
  const client = await ownerClient(owners.ownerA);
  const project = await client.from("projects").select("id").single();
  expect(project.error).toBeNull();
  if (!project.data) throw new Error("Fixture project is missing.");
  const task = await client.from("tasks").insert({ project_id: project.data.id, owner_user_id: owners.ownerA.id, title: "E2E timer concurrency", status: "todo" }).select("id").single();
  expect(task.error).toBeNull();
  if (!task.data) throw new Error("Fixture task is missing.");
  await signInPwaOwner(page, owners.ownerA, "/timer");
  const other = await context.newPage();
  let releaseStart = () => {};
  const startGate = new Promise<void>(resolve => { releaseStart = resolve; });
  try {
    await other.goto("/timer");
    await page.getByLabel("Select task", { exact: true }).selectOption(task.data.id);
    await other.getByLabel("Select task", { exact: true }).selectOption(task.data.id);
    // Submit from an idle second client, then let the first commit before the
    // delayed request arrives. This deterministically exercises stale-client recovery.
    await other.route("**/timer", async route => {
      if (route.request().method() === "POST") await startGate;
      await route.continue();
    });
    const competing = other.waitForRequest(request => request.method() === "POST" && new URL(request.url()).pathname === "/timer");
    await other.getByRole("button", { name: "Start session", exact: true }).click();
    await competing;
    await page.getByRole("button", { name: "Start session", exact: true }).click();
    await expect(page.getByRole("button", { name: "Stop session", exact: true })).toBeVisible();
    releaseStart();
    await expect(other.getByRole("alert").filter({ hasText: "A timer is already running. Stop it first." })).toBeVisible();
    await expect(other.getByRole("button", { name: "Stop session", exact: true })).toBeVisible();
    await other.unroute("**/timer");
    const first = await client.from("task_sessions").select("id").is("ended_at", null).single();
    expect(first.error).toBeNull();
    if (!first.data) throw new Error("Winning timer session is missing.");
    const firstId = first.data.id;
    await other.reload();
    await expect(other.locator('input[name="sessionId"]').first()).toHaveValue(firstId);

    let stoppedRequest: Request | undefined;
    let stopResponseLost = () => {};
    const lostResponse = new Promise<void>(resolve => { stopResponseLost = resolve; });
    await page.route("**/timer", async route => {
      if (route.request().method() !== "POST") { await route.continue(); return; }
      stoppedRequest = route.request();
      await route.fetch(); // The real stop commits; only its response is lost.
      await route.abort("connectionreset");
      stopResponseLost();
    });
    await page.getByRole("button", { name: "Stop session", exact: true }).click();
    await expect.poll(async () => {
      const result = await client.from("task_sessions").select("ended_at").eq("id", firstId).single();
      return result.data?.ended_at;
    }).toBeTruthy();
    await lostResponse;
    await page.unroute("**/timer");
    if (!stoppedRequest) throw new Error("The real stop action was not captured.");
    const stopUrl = stoppedRequest.url();
    const headers = await stoppedRequest.allHeaders();
    delete headers["content-length"];
    const data = stoppedRequest.postDataBuffer();
    if (!data) throw new Error("The real stop action has no body.");
    const finalized = await client.from("task_sessions").select("id,started_at,ended_at,duration_seconds").eq("id", firstId).single();
    expect(finalized.error).toBeNull();
    expect(finalized.data?.ended_at).toBeTruthy();
    // Replay the exact browser action, including its original session id. Never
    // print this request: its headers carry the disposable owner's cookies.
    async function retryOldStop() {
      const response = await context.request.post(stopUrl, { headers, data, maxRedirects: 0 }).catch(() => {
        throw new Error("Old stop replay failed; authenticated request details withheld.");
      });
      expect(response.ok()).toBe(true);
      const redirect = response.headers()["x-action-redirect"]?.split(";")[0];
      if (!redirect || !redirect.startsWith("/timer?")) throw new Error("Stop action did not return timer feedback.");
      await other.goto(redirect);
      await expect(other.getByRole("status").filter({ hasText: "Timer was already stopped." })).toBeVisible();
      const unchanged = await client.from("task_sessions").select("id,started_at,ended_at,duration_seconds").eq("id", firstId).single();
      expect(unchanged.error).toBeNull();
      expect(unchanged.data).toEqual(finalized.data);
    }
    await retryOldStop();
    await page.reload();
    await expect(page.getByRole("button", { name: "Stop session", exact: true })).toHaveCount(0);
    await page.getByLabel("Select task", { exact: true }).selectOption(task.data.id);
    await page.getByRole("button", { name: "Start session", exact: true }).click();
    await expect(page.getByRole("button", { name: "Stop session", exact: true })).toBeVisible();
    const second = await client.from("task_sessions").select("id,ended_at").is("ended_at", null).single();
    expect(second.error).toBeNull();
    expect(second.data?.id).not.toBe(firstId);
    await retryOldStop();
    await other.reload();
    const active = await client.from("task_sessions").select("id,ended_at").is("ended_at", null);
    expect(active.error).toBeNull();
    expect(active.data).toEqual([second.data]);
    await expect(other.locator('input[name="sessionId"]').first()).toHaveValue(second.data?.id ?? "missing");
  } finally {
    releaseStart();
    await other.close();
  }
});
