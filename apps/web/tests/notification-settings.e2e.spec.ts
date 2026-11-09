import { createClient } from "@supabase/supabase-js";
import { createApp, createAuthenticatedClient, verifyAccessToken } from "../../server/src/index";
import { readLocalEnvironment } from "../../../scripts/e2e/local-env.cjs";
import { test, expect, ownerClient } from "./disposable-fixtures";

test("notification settings PATCH preserves concurrent fields, rejects conflicts and isolates owners", async ({ owners }) => {
  const env = readLocalEnvironment();
  const a = await ownerClient(owners.ownerA);
  const b = await ownerClient(owners.ownerB);
  const sessionA = (await a.auth.getSession()).data.session;
  const sessionB = (await b.auth.getSession()).data.session;
  if (!sessionA || !sessionB) throw new Error("Ordinary fixture sessions are missing.");

  // Delay real PostgREST responses, never their values. Both requests must see
  // the same pre-write state, including the first-row insert race.
  let gate: { method: string; remaining: number; wait: Promise<void>; release: () => void } | undefined;
  function synchronize(method: string) {
    let release = () => {};
    const wait = new Promise<void>(resolve => { release = resolve; });
    gate = { method, remaining: 2, wait, release };
  }
  const app = createApp({
    verifyToken: token => verifyAccessToken(createAuthenticatedClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, token), token),
    createRequestClient: token => createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        headers: { Authorization: `Bearer ${token}` },
        fetch: async (input, init) => {
          const response = await fetch(input, init);
          const current = gate;
          if (current && current.remaining > 0 && init?.method === current.method && new URL(String(input)).pathname === "/rest/v1/notification_settings") {
            current.remaining--;
            if (current.remaining === 0) current.release();
            await current.wait;
          }
          return response;
        },
      },
    }),
  });
  const patch = (token: string, body: object) => app.request("/api/notifications/settings", {
    method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  async function settings() {
    const result = await a.from("notification_settings").select("owner_user_id,quiet_hours_enabled,quiet_hours_start,quiet_hours_end,updated_at").single();
    expect(result.error).toBeNull();
    if (!result.data) throw new Error("Owner settings are missing.");
    return result.data;
  }

  expect((await app.request("/api/notifications/settings")).status).toBe(401);
  const initial = await a.from("notification_settings").select("owner_user_id");
  expect(initial.error).toBeNull();
  expect(initial.data).toEqual([]);
  synchronize("PATCH");
  const created = await Promise.all([
    patch(sessionA.access_token, { quietHoursEnabled: true }),
    patch(sessionA.access_token, { quietHoursStart: "21:00" }),
  ]);
  expect(created.map(response => response.status)).toEqual([200, 200]);
  expect(await settings()).toMatchObject({ quiet_hours_enabled: true, quiet_hours_start: "21:00", quiet_hours_end: "07:00" });

  synchronize("GET");
  const updated = await Promise.all([
    patch(sessionA.access_token, { quietHoursStart: "20:00" }),
    patch(sessionA.access_token, { quietHoursEnd: "06:00" }),
  ]);
  expect(updated.map(response => response.status)).toEqual([200, 200]);
  expect(await settings()).toMatchObject({ quiet_hours_enabled: true, quiet_hours_start: "20:00", quiet_hours_end: "06:00" });

  synchronize("GET");
  const conflicting = await Promise.all([
    patch(sessionA.access_token, { quietHoursStart: "08:00" }),
    patch(sessionA.access_token, { quietHoursEnd: "08:00" }),
  ]);
  expect(conflicting.map(response => response.status).sort()).toEqual([200, 409]);
  const conflict = conflicting.find(response => response.status === 409);
  expect(await conflict?.json()).toMatchObject({ error: { code: "CONFLICT" } });
  const beforeInvalid = await settings();
  expect(beforeInvalid.quiet_hours_start).not.toBe(beforeInvalid.quiet_hours_end);
  expect(beforeInvalid.quiet_hours_enabled).toBe(true);
  for (const body of [{ quietHoursStart: "25:00" }, { quietHoursStart: "09:00", quietHoursEnd: "09:00" }]) {
    expect((await patch(sessionA.access_token, body)).status).toBe(400);
    expect(await settings()).toEqual(beforeInvalid);
  }

  expect((await patch(sessionB.access_token, { owner_user_id: owners.ownerA.id, quietHoursEnabled: false })).status).toBe(200);
  const ownB = await b.from("notification_settings").select("owner_user_id,quiet_hours_enabled").single();
  expect(ownB.error).toBeNull();
  expect(ownB.data).toMatchObject({ owner_user_id: owners.ownerB.id, quiet_hours_enabled: false });
  const foreign = await b.from("notification_settings").update({ quiet_hours_enabled: false }).eq("owner_user_id", owners.ownerA.id).select("owner_user_id");
  expect(foreign.error).toBeNull();
  expect(foreign.data).toEqual([]);
  expect(await settings()).toEqual(beforeInvalid);
});
