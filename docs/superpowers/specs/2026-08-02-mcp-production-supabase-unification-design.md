# MCP Production Supabase Unification Design

## Goal

Install the tested read-only EGA House MCP and Supabase OAuth capability into the existing `Ega-House-Platform` Supabase project (`ofpqkogwatceimtzvenh`) so existing users authorize agents against their existing projects, goals, and tasks without copying accounts or workspace data.

## Source and target

- Production data authority: `ofpqkogwatceimtzvenh` (`Ega-House-Platform`).
- MCP staging evidence source: `atmzqhpioaepykehjbui` (`EGAHOUSE MCP`).
- The staging project remains an isolated test environment. No staging user, project, goal, task, OAuth client, grant, token, or audit row is copied into production.

## Current production evidence

At design time the production project contains:

- 3 Supabase Auth users.
- 10 projects.
- 3 goals.
- 154 tasks.
- Existing `agent_integration_tokens`, `agent_integration_events`, and `task_external_refs` tables.
- No `mcp_authorization_grants` table.
- No `mcp_rate_limit_windows` table.
- RLS disabled on `projects`, `goals`, and `tasks`.

Two legacy project trees have invalid ownership:

- `TEST`, with `HELLO TEST`, `ship 2k`, and `ship 3k`.
- `x man`, with `test on ab acc`.

The approved reconciliation assigns orphaned project trees to the existing user identified by `lower(email) = 'ab.mortaki@gmail.com'`. The migration resolves the user ID at runtime and does not hardcode a generated UUID.

## Architecture

The production Supabase project becomes the single authority for authentication and application data:

```text
MCP client
  -> EGA House protected resource metadata
  -> Supabase OAuth 2.1 on ofpqkogwatceimtzvenh
  -> EGA House consent UI
  -> resource-bound Supabase access token
  -> EGA House MCP endpoint
  -> request-scoped Supabase client
  -> owner/client/resource/permission-bound RLS
  -> existing production projects, goals, and tasks
```

The MCP endpoint remains stateless and read-only. Normal direct EGA House sessions retain owner-scoped CRUD access. OAuth sessions receive SELECT access only when an active grant matches the token subject, OAuth client ID, exact resource audience, and required read permission.

## Migration boundary

The production migration performs only these changes:

1. Reconcile invalid ownership without deleting data.
2. Create `mcp_authorization_grants` with strict checks, RLS, and narrow grants.
3. Extend `agent_integration_events` for OAuth/MCP audit evidence while preserving legacy token-based events.
4. Create the Custom Access Token Hook function that changes `aud` only for an active user/client grant.
5. Enable owner-scoped RLS on `projects`, `goals`, and `tasks`.
6. Preserve direct authenticated CRUD while granting OAuth clients read-only access.
7. Create the private permission helper and distributed rate-limit table/function.
8. Add reviewed indexes and revoke unintended access to internal functions/tables.
9. Install the PostgreSQL 17 hook ambiguity fix.

The migration does not:

- Copy users or application rows between projects.
- Enable MCP writes.
- Create task mutation tools.
- Change application feature behavior outside authentication, authorization, audit, and RLS.
- Delete or archive any user data.
- Enable the Supabase OAuth Server or dashboard hook automatically; those dashboard settings are activated after database verification.
- Switch Vercel production variables before wire-level testing succeeds.

## Ownership reconciliation

The migration resolves the target owner by email and fails if exactly one matching user is not found.

It then:

1. Assigns every project whose owner is null or absent from `auth.users` to that target owner.
2. Assigns every goal whose owner is null or absent from `auth.users` to its parent project's valid owner.
3. Assigns every task whose owner is null or absent from `auth.users` to its parent project's valid owner.
4. Fails if any project, goal, or task still has a null or nonexistent owner.
5. Fails if any goal or task owner conflicts with its parent project owner.

This general invariant repairs the two observed test trees without relying on generated row IDs or fragile names.

## Authorization invariants

- Tokens without `client_id` remain ordinary direct-user tokens.
- OAuth tokens receive the MCP resource audience only when an active grant exists.
- Grant identity is bound to `owner_user_id`, `oauth_client_id`, and `resource_uri`.
- Permission documents are canonical and versioned.
- OAuth clients can read only their owner's `projects`, `goals`, and `tasks`.
- OAuth clients cannot insert, update, or delete those tables.
- Direct authenticated sessions can CRUD only rows owned by `auth.uid()`.
- MCP internal tables are not directly writable by `anon` or `authenticated` roles.
- Audit writes carry either a legacy token actor or an OAuth client plus grant actor.
- Rate limits are derived from the verified JWT context and active grant.

## Activation sequence

1. Commit the production reconciliation migration and regression tests.
2. Run the MCP CI matrix and production build.
3. Record pre-migration row counts and ownership checks.
4. Apply ownership reconciliation to `ofpqkogwatceimtzvenh`.
5. Apply tested MCP migrations `0037` through `0042` in order.
6. Verify row counts, ownership, RLS, functions, policies, grants, indexes, and migration history.
7. Run Supabase security and performance advisors.
8. Generate TypeScript database types and commit any required type changes.
9. Enable OAuth 2.1 Server, dynamic registration, `/oauth/consent`, and the Custom Access Token Hook in the production Supabase dashboard.
10. Point only the feature-branch Vercel Preview variables to production Supabase and redeploy.
11. Connect a new Hermes alias for production and test capabilities, projects, goals, tasks, audit evidence, user isolation, and denied writes.
12. Keep PR #112 in draft until the production test evidence is attached and reviewed.

## Failure and rollback

- Every database migration is transactional and fails closed.
- Precondition failures abort before partial schema activation.
- No production rows are deleted.
- If the MCP wire test fails, disable `MCP_ENABLED` and the Supabase Custom Access Token Hook; direct application access remains available.
- Existing MCP staging remains available for debugging.
- Reverting RLS requires an explicit reviewed rollback migration; it is not performed ad hoc.

## Acceptance criteria

- Production row counts remain 10 projects, 3 goals, and 154 tasks immediately after reconciliation and MCP schema installation.
- Every production project, goal, and task has a valid owner in `auth.users`.
- Goal and task owners match their parent project owner.
- Existing application users can still read and mutate their own records.
- OAuth clients can read only the authorizing user's records.
- OAuth clients cannot mutate project, goal, or task rows.
- The OAuth access token has the exact MCP resource URL in `aud`.
- Hermes discovers exactly the four reviewed read-only tools.
- Successful tool calls create token-free audit events.
- Unauthenticated requests return 401.
- No secret is committed or exposed to browser code.
