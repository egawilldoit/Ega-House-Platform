import { randomBytes } from "node:crypto";
import { test as base, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

import { readLocalEnvironment } from "../../../scripts/e2e/local-env.cjs";
import type { PwaOwner } from "./pwa-fixtures";

type Owner = PwaOwner & { id: string };
type Owners = { ownerA: Owner; ownerB: Owner };

export const test = base.extend<{ owners: Owners; disposable: void }>({
  context: async ({ context }, provide) => {
    // The authenticated suite must never follow a production link or redirect.
    const external: string[] = [];
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.hostname === "127.0.0.1" && ["3000", "55321"].includes(url.port)) await route.continue();
      else { external.push(url.origin); await route.abort("blockedbyclient"); }
    });
    await provide(context);
    expect(external, "Browser attempted to leave the disposable environment").toEqual([]);
  },
  owners: async ({}, provide) => {
    const env = readLocalEnvironment();
    const sql = postgres(env.DATABASE_URL, { max: 1, onnotice: () => {} });
    const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const created: Owner[] = [];
    try {
      const marker = await sql`SELECT id FROM e2e_private.run`;
      if (marker.length !== 1 || marker[0].id !== env.E2E_RUN_ID) throw new Error("Disposable database identity mismatch.");
      async function owner(label: string): Promise<Owner> {
        const email = `${env.E2E_RUN_ID}-${label}-${randomBytes(6).toString("hex")}@example.test`;
        const password = randomBytes(24).toString("base64url");
        const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
        if (error || !data.user) throw new Error("Unable to provision disposable test owner.");
        const result = { id: data.user.id, email, password };
        created.push(result);
        // Explicit fixture preferences keep civil dates and schedule expectations deterministic.
        await sql`INSERT INTO user_preferences (user_id) VALUES (${result.id})`;
        await sql`INSERT INTO user_time_context (user_id, iana_timezone) VALUES (${result.id}, 'Africa/Casablanca')`;
        await sql`INSERT INTO projects (name, slug, owner_user_id) VALUES ('E2E workspace', ${`e2e-${result.id}`}, ${result.id})`;
        return result;
      }
      await provide({ ownerA: await owner("a"), ownerB: await owner("b") });
    } finally {
      let cleanupFailed = false;
      for (const owner of created) {
        const { error } = await admin.auth.admin.deleteUser(owner.id);
        cleanupFailed ||= Boolean(error);
      }
      await sql.end({ timeout: 5 });
      if (cleanupFailed) throw new Error("Fixture account cleanup failed; remove the disposable backend before retrying.");
    }
  },
  disposable: [async ({ owners }, provide) => {
    // Legacy helpers read process env. One worker, fresh accounts per test, no shared owner state.
    const env = readLocalEnvironment();
    const values = {
      E2E_AUTH_BASE_URL: env.E2E_AUTH_BASE_URL,
      E2E_AUTH_EMAIL: owners.ownerA.email, E2E_AUTH_PASSWORD: owners.ownerA.password,
      E2E_AUTH_SECOND_EMAIL: owners.ownerB.email, E2E_AUTH_SECOND_PASSWORD: owners.ownerB.password,
      E2E_SEED_DATABASE_URL: env.DATABASE_URL, PO02_DISPOSABLE_ENV: "1", PO03_DISPOSABLE_ENV: "1",
    };
    const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
    Object.assign(process.env, values);
    try { await provide(); } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  }, { auto: true }],
});

export { expect };

export async function ownerClient(owner: PwaOwner) {
  const env = readLocalEnvironment();
  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword(owner);
  if (error) throw new Error("Unable to authenticate ordinary fixture client.");
  return client;
}
