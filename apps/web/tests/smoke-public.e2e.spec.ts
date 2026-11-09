import { expect, test } from "@playwright/test";

test("public homepage contract @smoke", async ({ page }) => {
  await page.goto("/");
  const hero = page.locator("section#top");
  await expect(hero.getByRole("heading", { level: 1, name: "Turn intention into execution." })).toBeVisible();
  await expect(hero.getByRole("link", { name: "Enter workspace" })).toHaveAttribute("href", "/login?next=%2Fdashboard");
});

test("login form is present without signing in @smoke", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { level: 2, name: "Sign in to continue" })).toBeVisible();
  await expect(page.getByLabel("Email address")).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Enter workspace" })).toBeEnabled();
});

test("signup form is present without submission @smoke", async ({ page }) => {
  await page.goto("/signup");
  await expect(page).toHaveURL(/\/signup\/?$/);
  await expect(page.getByRole("heading", { level: 1, name: "Build your control room." })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Create your secure workspace" })).toBeVisible();
});
