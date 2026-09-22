import { randomUUID } from "node:crypto";

import postgres from "postgres";
import type { Page } from "@playwright/test";

const protocol = process.env.E2E_AUTH_PROTOCOL ?? "https";
const platformRootDomain = process.env.E2E_AUTH_PLATFORM_DOMAIN ?? "egawilldoit.online";
const loginHost = process.env.E2E_AUTH_LOGIN_HOST ?? `www.${platformRootDomain}`;

export type PwaOwner = Readonly<{ email: string; password: string }>;

export type PwaFixtures = Readonly<{
  page: Page;
  ownerA: PwaOwner;
  ownerB: PwaOwner | null;
  setUnreadNotifications: (count: number) => Promise<void>;
}>;

const SEED_IDEMPOTENCY_PREFIX = "e2e-pwa-";
const MAX_SEED_COUNT = 100;

export function hasPwaAuthCredentials(): boolean {
  return Boolean(process.env.E2E_AUTH_EMAIL && process.env.E2E_AUTH_PASSWORD);
}

export function getPwaOwners(): { ownerA: PwaOwner; ownerB: PwaOwner | null } {
  const ownerA: PwaOwner = {
    email: process.env.E2E_AUTH_EMAIL ?? "",
    password: process.env.E2E_AUTH_PASSWORD ?? "",
  };
  const ownerB =
    process.env.E2E_AUTH_SECOND_EMAIL && process.env.E2E_AUTH_SECOND_PASSWORD
      ? {
          email: process.env.E2E_AUTH_SECOND_EMAIL,
          password: process.env.E2E_AUTH_SECOND_PASSWORD,
        }
      : null;
  return { ownerA, ownerB };
}

export async function signInPwaOwner(page: Page, owner: PwaOwner, next?: string): Promise<void> {
  const suffix = next ? `?next=${encodeURIComponent(next)}` : "";
  await page.goto(`${protocol}://${loginHost}/login${suffix}`);
  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  try {
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
  } catch (waitError) {
    const loginErrorAlert = page.getByRole("alert").first();
    const hasLoginErrorAlert = await loginErrorAlert.isVisible().catch(() => false);
    if (hasLoginErrorAlert) {
      const alertText = (await loginErrorAlert.innerText()).trim();
      throw new Error(`Sign in stayed on /login with error: ${alertText || "Unknown error"}`);
    }
    throw waitError;
  }
}

async function resolveOwnerId(sql: postgres.Sql, owner: PwaOwner): Promise<string> {
  const rows = await sql<Array<{ id: string }>>`
    select id from auth.users where lower(email) = lower(${owner.email})
  `;
  if (rows.length === 0) {
    throw new Error(
      "PWA seed account not found; provision the fixture owner before running authenticated PWA checks.",
    );
  }
  if (rows.length > 1) {
    throw new Error(
      "PWA seed account email is ambiguous; the fixture owner email must resolve to exactly one auth user.",
    );
  }
  return rows[0].id;
}

export async function setUnreadNotificationsForOwner(owner: PwaOwner, count: number): Promise<void> {
  if (!Number.isInteger(count) || count < 0 || count > MAX_SEED_COUNT) {
    throw new Error(`count must be an integer between 0 and ${MAX_SEED_COUNT}.`);
  }
  if (!process.env.E2E_SEED_DATABASE_URL) {
    throw new Error("E2E_SEED_DATABASE_URL is required to seed notification fixtures.");
  }
  const sql = postgres(process.env.E2E_SEED_DATABASE_URL, { max: 1 });
  try {
    const ownerId = await resolveOwnerId(sql, owner);
    await sql.begin(async (tx) => {
      await tx`
        delete from notifications
        where owner_user_id = ${ownerId} and idempotency_key like ${`${SEED_IDEMPOTENCY_PREFIX}%`}
      `;
      if (count > 0) {
        await tx`
          insert into notifications (owner_user_id, type, title, idempotency_key)
          select
            ${ownerId},
            'task_reminder',
            'E2E PWA baseline reminder',
            ${SEED_IDEMPOTENCY_PREFIX} || ${randomUUID()} || '-' || n
          from generate_series(1, ${count}) as n
        `;
      }
    });
    const unreadRows = await sql<Array<{ count: number }>>`
      select count(*)::int as count from notifications
      where owner_user_id = ${ownerId} and read_at is null
    `;
    const unread = unreadRows[0]?.count ?? 0;
    if (unread !== count) {
      throw new Error(
        `Fixture owner has ${unread} uncontrolled unread notification(s) outside the '${SEED_IDEMPOTENCY_PREFIX}' namespace; provision a dedicated clean e2e fixture account so setUnreadNotifications can deliver exactly ${count} unread.`,
      );
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function clearSeededNotificationsForOwner(owner: PwaOwner): Promise<void> {
  if (!process.env.E2E_SEED_DATABASE_URL) {
    return;
  }
  const sql = postgres(process.env.E2E_SEED_DATABASE_URL, { max: 1 });
  try {
    const ownerId = await resolveOwnerId(sql, owner);
    await sql`
      delete from notifications
      where owner_user_id = ${ownerId} and idempotency_key like ${`${SEED_IDEMPOTENCY_PREFIX}%`}
    `;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function createPwaFixtures(page: Page): Promise<PwaFixtures> {
  const { ownerA, ownerB } = getPwaOwners();
  if (!hasPwaAuthCredentials()) {
    throw new Error(
      "Authenticated PWA fixtures require E2E_AUTH_EMAIL and E2E_AUTH_PASSWORD; gate tests with hasPwaAuthCredentials() before calling this.",
    );
  }
  await signInPwaOwner(page, ownerA);
  return {
    page,
    ownerA,
    ownerB,
    setUnreadNotifications: (count: number) => setUnreadNotificationsForOwner(ownerA, count),
  };
}
