import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

const protocol = process.env.E2E_AUTH_PROTOCOL ?? "https";
const platformRootDomain = process.env.E2E_AUTH_PLATFORM_DOMAIN ?? "egawilldoit.online";
const loginHost = process.env.E2E_AUTH_LOGIN_HOST ?? `www.${platformRootDomain}`;
const email = process.env.E2E_AUTH_EMAIL;
const password = process.env.E2E_AUTH_PASSWORD;

const workspaceHosts = {
  tasks: process.env.E2E_AUTH_TASKS_HOST ?? `tasks.${platformRootDomain}`,
  goals: process.env.E2E_AUTH_GOALS_HOST ?? `goals.${platformRootDomain}`,
  timer: process.env.E2E_AUTH_TIMER_HOST ?? `timer.${platformRootDomain}`,
  review: process.env.E2E_AUTH_REVIEW_HOST ?? `review.${platformRootDomain}`,
};

const workspaceHeadings = {
  tasks: "Tasks",
  goals: "Goals",
  timer: "Focus Timer",
  review: "Weekly Review",
} as const;

const rootProtectedPaths = ["/tasks", "/goals", "/timer", "/review"] as const;
const dashboardPath = "/dashboard";

function getLoginUrl() {
  return `${protocol}://${loginHost}/login`;
}

function assertExpectedNext(nextValue: string | null, expectedHost: string, expectedPath: string) {
  expect(nextValue, "Expected ?next to be set").toBeTruthy();
  const nextUrl = new URL(nextValue ?? "");
  expect(nextUrl.hostname).toBe(expectedHost);
  expect(nextUrl.pathname).toBe(expectedPath);
}

async function assertRedirectedToLoginWithNext(
  page: Page,
  expectedHost: string,
  expectedPath: string,
) {
  await page.waitForURL((url) => url.pathname === "/login", { timeout: 20_000 });
  const redirected = new URL(page.url());
  expect(redirected.hostname).toBe(loginHost);
  expect(redirected.pathname).toBe("/login");
  assertExpectedNext(redirected.searchParams.get("next"), expectedHost, expectedPath);
}

async function signInFromRootLogin(
  page: Page,
  next?: string,
) {
  const runtimePageErrors: string[] = [];
  page.on("pageerror", (error) => {
    runtimePageErrors.push(error.message);
  });

  const loginUrl = next ? `${getLoginUrl()}?next=${encodeURIComponent(next)}` : getLoginUrl();
  await page.goto(loginUrl);
  await page.getByLabel("Email").fill(email ?? "");
  await page.getByLabel("Password").fill(password ?? "");
  await page.getByRole("button", { name: "Sign in" }).click();

  try {
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
      timeout: 20_000,
    });
  } catch (waitError) {
    if (runtimePageErrors.length > 0) {
      throw new Error(
        `Login stayed on /login due to runtime error: ${runtimePageErrors.join(" | ")}`,
      );
    }

    const loginErrorAlert = page.getByRole("alert").first();
    const hasLoginErrorAlert = await loginErrorAlert.isVisible().catch(() => false);

    if (hasLoginErrorAlert) {
      const alertText = (await loginErrorAlert.innerText()).trim();
      throw new Error(`Login stayed on /login with error: ${alertText || "Unknown error"}`);
    }

    throw waitError;
  }
}

test.describe("Cross-subdomain auth session", () => {
  test.skip(
    !email || !password,
    "Set E2E_AUTH_EMAIL and E2E_AUTH_PASSWORD to run real auth/session coverage.",
  );

  test("unauthenticated requests to protected root routes redirect to login", async ({
    page,
  }) => {
    for (const protectedPath of [dashboardPath, ...rootProtectedPaths]) {
      await page.goto(`${protocol}://${loginHost}${protectedPath}`);
      await assertRedirectedToLoginWithNext(page, loginHost, protectedPath);
    }
  });

  test("signed-out visit to root renders public landing page", async ({ page }) => {
    await page.goto(`${protocol}://${loginHost}/`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "One command surface",
    );
    await expect(page.getByRole("link", { name: "Login" })).toHaveAttribute(
      "href",
      "/login?next=%2Fdashboard",
    );
  });

  test("unauthenticated requests to protected subdomains redirect to login", async ({
    page,
  }) => {
    for (const host of Object.values(workspaceHosts)) {
      await page.goto(`${protocol}://${host}/`, { waitUntil: "domcontentloaded" });
      await assertRedirectedToLoginWithNext(page, host, "/");
    }
  });

  test("login from root flow honors next redirect to protected subdomain", async ({
    page,
  }) => {
    const targetWorkspaceHost = workspaceHosts.tasks;
    const expectedHeading = workspaceHeadings.tasks;
    const next = `https://${targetWorkspaceHost}/`;

    await signInFromRootLogin(page, next);
    await expect(page).toHaveURL(new RegExp(`^https://${targetWorkspaceHost}/?$`));
    await expect(page.getByRole("heading", { level: 1, name: expectedHeading })).toBeVisible();
  });

  test("authenticated session persists across all protected root routes and workspace subdomains", async ({
    page,
  }) => {
    await signInFromRootLogin(page);
    await expect(page).toHaveURL(new RegExp(`^https://${loginHost}${dashboardPath}/?$`));
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();

    await page.goto(`${protocol}://${loginHost}/`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page).toHaveURL(new RegExp(`^https://${loginHost}${dashboardPath}/?$`));

    for (const [workspace, host] of Object.entries(workspaceHosts) as Array<
      [keyof typeof workspaceHosts, string]
    >) {
      await page.goto(`${protocol}://${host}/`, { waitUntil: "domcontentloaded" });
      await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
      await expect(
        page.getByRole("heading", { level: 1, name: workspaceHeadings[workspace] }),
      ).toBeVisible();
    }

    for (const path of [dashboardPath, ...rootProtectedPaths]) {
      await page.goto(`${protocol}://${loginHost}${path}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
    }
  });

  test("logout from shell clears session and forces protected routes back to login", async ({
    page,
  }) => {
    await signInFromRootLogin(page);
    await expect(page).toHaveURL(new RegExp(`^https://${loginHost}${dashboardPath}/?$`));

    await page.getByRole("button", { name: "Logout" }).click();
    await page.waitForURL((url) => url.hostname === loginHost && url.pathname === "/login", {
      timeout: 20_000,
    });
    await expect(page.getByRole("heading", { level: 2, name: "Sign in to continue" })).toBeVisible();

    await page.goto(`${protocol}://${loginHost}${dashboardPath}`, {
      waitUntil: "domcontentloaded",
    });
    await assertRedirectedToLoginWithNext(page, loginHost, dashboardPath);
  });
});
