# MCP Production Supabase Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install the tested read-only EGA House MCP/OAuth capability into production Supabase project `ofpqkogwatceimtzvenh` without copying or deleting users or application data.

**Architecture:** Production remains the single authority for Supabase Auth and EGA House data. A deterministic owner-reconciliation migration repairs invalid legacy ownership first, then the reviewed MCP migrations install resource-bound grants, audit support, read-only OAuth RLS, distributed rate limiting, and the access-token audience hook. OAuth dashboard activation and Vercel preview cutover occur only after database verification.

**Tech Stack:** PostgreSQL 17, Supabase Auth/OAuth 2.1, Supabase RLS/Auth Hooks, Drizzle SQL migrations, TypeScript, Vitest, Next.js 16, Vercel Preview, Hermes MCP client.

## Global Constraints

- Target only Supabase project `ofpqkogwatceimtzvenh`.
- Preserve all existing users, projects, goals, tasks, and related application rows.
- Resolve the reconciliation owner at runtime with `lower(email) = 'ab.mortaki@gmail.com'`; do not hardcode generated user or row UUIDs.
- Assign only null/nonexistent project owners to the reconciliation owner.
- Assign only null/nonexistent goal/task owners from their valid parent project owner.
- Abort if ownership remains invalid or conflicts with parent-project ownership.
- Keep MCP read-only: `MCP_WRITES_ENABLED=false`.
- Do not copy staging users, rows, grants, OAuth clients, tokens, or audit data.
- Do not change Vercel production variables during this plan.
- Do not merge PR #112 during this plan.
- Apply DDL only through named Supabase migrations.
- Record exact pre/post row counts and advisor results.

---

### Task 1: Add production ownership reconciliation migration

**Files:**
- Create: `drizzle/0043_mcp_production_owner_reconciliation.sql`
- Modify: `drizzle/meta/_journal.json`
- Modify: `src/lib/mcp/rls-migration.test.ts`

**Interfaces:**
- Consumes: `auth.users`, `public.projects.owner_user_id`, `public.goals.project_id/owner_user_id`, `public.tasks.project_id/owner_user_id`.
- Produces: a database state where every project/goal/task owner exists in `auth.users` and every goal/task owner matches the parent project owner.

- [ ] **Step 1: Write the failing migration contract test**

Add a migration path constant and assertions that the SQL:

```ts
expect(migration).toContain("lower(email) = 'ab.mortaki@gmail.com'");
expect(migration).toContain("COUNT(*) <> 1");
expect(migration).toContain("NOT EXISTS (SELECT 1 FROM auth.users");
expect(migration).toContain("goal_record.owner_user_id IS DISTINCT FROM project_record.owner_user_id");
expect(migration).toContain("task_record.owner_user_id IS DISTINCT FROM project_record.owner_user_id");
expect(migration).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
npx vitest run src/lib/mcp/rls-migration.test.ts
```

Expected: FAIL because `0043_mcp_production_owner_reconciliation.sql` does not exist.

- [ ] **Step 3: Implement the migration**

The migration must:

```sql
DO $$
DECLARE
  v_target_owner uuid;
  v_target_count integer;
BEGIN
  SELECT count(*), min(id)
  INTO v_target_count, v_target_owner
  FROM auth.users
  WHERE lower(email) = 'ab.mortaki@gmail.com';

  IF v_target_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one reconciliation owner.';
  END IF;

  UPDATE public.projects AS project_record
  SET owner_user_id = v_target_owner,
      updated_at = now()
  WHERE project_record.owner_user_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM auth.users AS auth_user
       WHERE auth_user.id = project_record.owner_user_id
     );

  UPDATE public.goals AS goal_record
  SET owner_user_id = project_record.owner_user_id,
      updated_at = now()
  FROM public.projects AS project_record
  WHERE goal_record.project_id = project_record.id
    AND (
      goal_record.owner_user_id IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM auth.users AS auth_user
        WHERE auth_user.id = goal_record.owner_user_id
      )
    );

  UPDATE public.tasks AS task_record
  SET owner_user_id = project_record.owner_user_id,
      updated_at = now()
  FROM public.projects AS project_record
  WHERE task_record.project_id = project_record.id
    AND (
      task_record.owner_user_id IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM auth.users AS auth_user
        WHERE auth_user.id = task_record.owner_user_id
      )
    );

  IF EXISTS (
    SELECT 1 FROM public.projects AS project_record
    WHERE project_record.owner_user_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM auth.users AS auth_user WHERE auth_user.id = project_record.owner_user_id)
  ) THEN
    RAISE EXCEPTION 'Project ownership reconciliation failed.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.goals AS goal_record
    JOIN public.projects AS project_record ON project_record.id = goal_record.project_id
    WHERE goal_record.owner_user_id IS DISTINCT FROM project_record.owner_user_id
  ) THEN
    RAISE EXCEPTION 'Goal ownership does not match parent project.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.tasks AS task_record
    JOIN public.projects AS project_record ON project_record.id = task_record.project_id
    WHERE task_record.owner_user_id IS DISTINCT FROM project_record.owner_user_id
  ) THEN
    RAISE EXCEPTION 'Task ownership does not match parent project.';
  END IF;
END
$$;
```

Add journal entry index `42`, tag `0042_fix_mcp_oauth_hook_variable_ambiguity`, followed by index `43`, tag `0043_mcp_production_owner_reconciliation`, with monotonically increasing timestamps.

- [ ] **Step 4: Run focused tests**

Run:

```bash
npx vitest run src/lib/mcp/rls-migration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add drizzle/0043_mcp_production_owner_reconciliation.sql drizzle/meta/_journal.json src/lib/mcp/rls-migration.test.ts
git commit -m "fix(mcp): reconcile production ownership before RLS"
```

### Task 2: Validate repository integration

**Files:**
- Verify: `drizzle/0037_mcp_oauth_foundation.sql`
- Verify: `drizzle/0038_mcp_read_only_rls.sql`
- Verify: `drizzle/0039_mcp_grant_permission_consistency.sql`
- Verify: `drizzle/0040_mcp_distributed_rate_limit.sql`
- Verify: `drizzle/0041_mcp_security_performance_hardening.sql`
- Verify: `drizzle/0042_fix_mcp_oauth_hook_variable_ambiguity.sql`
- Verify: `drizzle/0043_mcp_production_owner_reconciliation.sql`

**Interfaces:**
- Consumes: exact migration files and application MCP code.
- Produces: green repository evidence for the exact head SHA.

- [ ] **Step 1: Run exact dependency installation**

```bash
npm ci
```

Expected: exit 0.

- [ ] **Step 2: Run production dependency audit**

```bash
npm audit --omit=dev
```

Expected: 0 known production vulnerabilities.

- [ ] **Step 3: Run TypeScript, lint, tests, and build**

```bash
npm run typecheck
npm run lint
npx vitest run src/lib/mcp
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 4: Inspect final diff**

Verify no secrets, generated UUIDs, staging data, or write-tool activation were introduced.

### Task 3: Capture production preflight evidence

**Files:**
- Create: `docs/implementation/2026-08-02-mcp-production-supabase-cutover-evidence.md`

**Interfaces:**
- Consumes: read-only SQL evidence from `ofpqkogwatceimtzvenh`.
- Produces: immutable pre/post migration evidence and rollback reference.

- [ ] **Step 1: Record preflight counts**

Execute read-only SQL for:

```sql
SELECT
  (SELECT count(*) FROM auth.users) AS auth_users,
  (SELECT count(*) FROM public.projects) AS projects,
  (SELECT count(*) FROM public.goals) AS goals,
  (SELECT count(*) FROM public.tasks) AS tasks,
  (SELECT count(*) FROM public.agent_integration_events) AS integration_events;
```

Expected baseline: 3 users, 10 projects, 3 goals, 154 tasks, 0 events.

- [ ] **Step 2: Record invalid ownership counts**

Execute queries for null/nonexistent owners and parent-owner conflicts. Expected before reconciliation: two invalid projects and four dependent rows; zero valid-owner conflicts.

- [ ] **Step 3: Record existing migrations and advisors**

Capture `list_migrations`, security advisors, and performance advisors.

- [ ] **Step 4: Commit evidence checkpoint**

```bash
git add docs/implementation/2026-08-02-mcp-production-supabase-cutover-evidence.md
git commit -m "docs(mcp): record production Supabase preflight"
```

### Task 4: Apply production database migrations

**Files:**
- Apply: `drizzle/0043_mcp_production_owner_reconciliation.sql`
- Apply: `drizzle/0037_mcp_oauth_foundation.sql`
- Apply: `drizzle/0038_mcp_read_only_rls.sql`
- Apply: `drizzle/0039_mcp_grant_permission_consistency.sql`
- Apply: `drizzle/0040_mcp_distributed_rate_limit.sql`
- Apply: `drizzle/0041_mcp_security_performance_hardening.sql`
- Apply: `drizzle/0042_fix_mcp_oauth_hook_variable_ambiguity.sql`

**Interfaces:**
- Consumes: validated migration SQL from the exact GitHub head.
- Produces: production MCP schema with owner-scoped direct access and OAuth read-only access.

- [ ] **Step 1: Apply ownership reconciliation first**

Use Supabase named migration:

```text
mcp_production_owner_reconciliation
```

Expected: success with unchanged row counts.

- [ ] **Step 2: Verify ownership before enabling RLS**

Expected: zero invalid owners and zero parent-owner conflicts.

- [ ] **Step 3: Apply MCP migrations in order**

Apply named migrations:

```text
mcp_oauth_foundation
mcp_read_only_rls
mcp_grant_permission_consistency
mcp_distributed_rate_limit
mcp_security_performance_hardening
fix_mcp_oauth_hook_variable_ambiguity
```

Expected: every migration succeeds; stop immediately on first failure.

- [ ] **Step 4: Verify post-migration invariants**

Expected:

```text
projects=10
goals=3
tasks=154
mcp_authorization_grants exists with RLS enabled
mcp_rate_limit_windows exists with RLS enabled
projects/goals/tasks RLS enabled
custom_access_token_hook(jsonb) exists
private.has_active_mcp_permission(text) exists
consume_mcp_rate_limit(text, integer, integer) exists
```

- [ ] **Step 5: Run advisors**

Run security and performance advisors. MCP-specific critical errors must be zero. Pre-existing unrelated findings remain documented rather than silently changed.

### Task 5: Generate types and prepare OAuth activation

**Files:**
- Modify: generated Supabase database type file identified by repository search.
- Modify: `docs/implementation/2026-08-02-mcp-production-supabase-cutover-evidence.md`

**Interfaces:**
- Consumes: migrated production schema.
- Produces: repository types synchronized with production and exact dashboard activation instructions.

- [ ] **Step 1: Generate TypeScript types from `ofpqkogwatceimtzvenh`**

Use Supabase type generation and compare with the repository type authority. Commit only intentional schema additions.

- [ ] **Step 2: Record dashboard-only activation steps**

Document:

```text
Authentication -> OAuth Server -> enabled
Authorization Path -> /oauth/consent
Allow Dynamic OAuth Apps -> enabled
Authentication -> Auth Hooks -> Customize Access Token -> public.custom_access_token_hook
```

Do not claim these settings are active until verified in the dashboard.

- [ ] **Step 3: Record Vercel preview cutover variables**

Document branch-specific values for:

```text
NEXT_PUBLIC_SUPABASE_URL=https://ofpqkogwatceimtzvenh.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<production publishable key>
SUPABASE_SECRET_KEY=<production secret key>
MCP_RESOURCE_URL=<stable preview /api/mcp URL>
MCP_ENABLED=true
MCP_WRITES_ENABLED=false
```

- [ ] **Step 4: Commit generated types and evidence**

```bash
git add <generated-type-file> docs/implementation/2026-08-02-mcp-production-supabase-cutover-evidence.md
git commit -m "docs(mcp): complete production Supabase cutover evidence"
```

### Task 6: Wire-level production preview test

**Files:**
- Modify: `docs/implementation/2026-08-02-mcp-production-supabase-cutover-evidence.md`

**Interfaces:**
- Consumes: production OAuth server, enabled hook, Vercel Preview endpoint, existing EGA House user.
- Produces: real-user MCP proof without merging or enabling writes.

- [ ] **Step 1: Connect a separate Hermes alias**

Use `ega_house_production_test` so staging credentials remain independently revocable.

- [ ] **Step 2: Test capability profile**

Expected: `read_only`, permissions version `1`, three read permissions, writes disabled.

- [ ] **Step 3: Test projects, goals, and tasks**

Expected: returned rows belong only to the authorizing production user and match direct database counts for that owner.

- [ ] **Step 4: Test denied write behavior**

Confirm no write tools are advertised and a direct OAuth mutation attempt is denied by RLS.

- [ ] **Step 5: Verify audit and rate-limit evidence**

Expected: token-free OAuth audit rows contain owner, client, grant, request ID, tool, duration, and no error for successful calls.

- [ ] **Step 6: Update PR #112 evidence**

Attach exact SHA, CI run, Vercel deployment, Supabase migration list, advisor results, OAuth proof, tool outputs, isolation proof, and rollback status. Keep the PR draft until review explicitly approves merge.
