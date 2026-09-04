import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function readMigration(name: string) {
  return readFileSync(resolve(process.cwd(), "..", "..", "drizzle", name), "utf8");
}

const migration = readMigration("0062_project_purge.sql");

describe("archived project purge migration", () => {
  it("derives identity from the verified JWT and restricts to direct user sessions", () => {
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.purge_archived_project(",
    );
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain("v_actor := (SELECT auth.uid());");
    expect(migration).toContain("IF v_actor IS NULL THEN");
    expect(migration).toContain("((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL");
    expect(migration).not.toContain("p_owner_user_id");
    expect(migration).not.toContain("p_user_id");
    expect(migration).not.toContain("service_role");
  });

  it("enforces the archived invariant and confirmation/count gates inside the transaction", () => {
    expect(migration).toContain("FOR UPDATE");
    expect(migration).toContain("'archived'");
    expect(migration).toContain("not_archived");
    expect(migration).toContain("p_confirmation_name <> v_project_name");
    expect(migration).toContain("confirmation_mismatch");
    expect(migration).toContain("p_expected_task_count");
    expect(migration).toContain("p_expected_goal_count");
    expect(migration).toContain("contents_changed");
  });

  it("scopes every destructive statement by owner", () => {
    expect(migration).toContain("owner_user_id = v_actor");
    // Project, tasks, goals, sessions, external refs, notifications, calendar jobs.
    expect(migration.match(/owner_user_id = v_actor/g)?.length).toBeGreaterThanOrEqual(7);
  });

  it("deletes project-owned work data and preserves audit history", () => {
    expect(migration).toContain("DELETE FROM public.tasks");
    expect(migration).toContain("DELETE FROM public.goals");
    expect(migration).toContain("DELETE FROM public.task_sessions");
    expect(migration).toContain("DELETE FROM public.task_external_refs");
    expect(migration).toContain("DELETE FROM public.notifications");
    expect(migration).toContain("DELETE FROM public.projects");
    expect(migration).toContain("INSERT INTO public.calendar_sync_jobs");
    expect(migration).toContain("operation,\n    status,");
    expect(migration).toContain(
      "OR (existing_job.status = 'failed' AND existing_job.attempts < 5)",
    );
    expect(migration).toContain("MAX_CALENDAR_SYNC_ATTEMPTS = 5");
    expect(migration).not.toContain("DELETE FROM public.agent_integration_events");
    expect(migration).not.toContain("DELETE FROM public.operator_proposals");
    expect(migration).not.toContain("DELETE FROM public.calendar_sync_jobs");
  });

  it("keeps RPC execution explicit for authenticated callers only", () => {
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.purge_archived_project(uuid, text, integer, integer) FROM PUBLIC",
    );
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.purge_archived_project(uuid, text, integer, integer) FROM anon",
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.purge_archived_project(uuid, text, integer, integer) TO authenticated",
    );
  });

  it("leaves project/tasks/goals FK delete semantics restrictive", () => {
    const goalsMigration = readMigration("0001_narrow_bastion.sql");
    const tasksMigration = readMigration("0002_famous_whirlwind.sql");
    expect(goalsMigration).toContain(
      'FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action',
    );
    expect(tasksMigration).toContain(
      'FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action',
    );
    expect(migration).not.toMatch(/ON DELETE CASCADE/i);
  });
});
