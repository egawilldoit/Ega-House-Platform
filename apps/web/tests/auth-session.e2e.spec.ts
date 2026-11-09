import { test, expect } from "./disposable-fixtures";
import { signInPwaOwner } from "./pwa-fixtures";

test("protected pages reject a signed-out browser", async ({ request }) => {
  for (const path of ["/dashboard", "/tasks", "/timer", "/review"]) {
    // Exercise the real host-routing policy on loopback without following its public redirect.
    const response = await request.get(path, {
      headers: { "x-forwarded-host": "www.egawilldoit.online" }, maxRedirects: 0,
    });
    expect(response.status()).toBe(307);
    const location = new URL(response.headers().location);
    expect(location.origin).toBe("https://www.egawilldoit.online");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe(`https://www.egawilldoit.online${path}`);
  }
});

test("real login survives reload and logout revokes protected access", async ({ page, owners }) => {
  await signInPwaOwner(page, owners.ownerA, "/tasks");
  await expect(page.getByRole("heading", { level: 1, name: "Tasks", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Tasks", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Logout", exact: true }).click();
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  expect((await page.context().cookies()).filter(cookie => cookie.name.startsWith("sb-") && cookie.name.includes("auth-token"))).toEqual([]);
  const response = await page.request.get("/timer/export");
  expect(response.status()).toBe(401);
  expect(await response.json()).toEqual({ error: "Unauthorized." });
});
