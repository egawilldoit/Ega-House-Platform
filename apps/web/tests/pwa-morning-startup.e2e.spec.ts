import { expect, test, ownerClient } from "./disposable-fixtures";

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
