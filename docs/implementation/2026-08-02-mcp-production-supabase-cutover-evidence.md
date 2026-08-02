# MCP Production Supabase Cutover Evidence

## Scope

Target Supabase project: `ofpqkogwatceimtzvenh` (`Ega-House-Platform`).

This checkpoint records the database-only production unification. OAuth dashboard activation, Vercel Preview cutover, and real Hermes OAuth testing remain intentionally separate gates.

## Repository evidence

Branch: `feat/mcp-oauth-integration`

Ownership reconciliation exact green head:

```text
ca1fe56f7cb80d3407fb803ba0bad4d36b7cab5b
```

GitHub MCP Integration CI run `30740486552` passed:

- exact dependency installation
- production dependency audit
- TypeScript
- scoped MCP lint
- unit and migration contract tests
- production build

The unsupported PostgreSQL expression `min(uuid)` was caught during the first production attempt. That migration aborted before changing rows. A regression test was added, the lookup was replaced with a count query plus scalar `SELECT id ... LIMIT 1`, and the corrected exact head passed CI before retry.

## Applied Supabase migrations

```text
20260802085026  mcp_production_owner_reconciliation
20260802085205  mcp_oauth_foundation
20260802085226  mcp_read_only_rls
20260802085243  mcp_grant_permission_consistency
20260802085305  mcp_distributed_rate_limit
20260802085335  mcp_security_performance_hardening
20260802085355  fix_mcp_oauth_hook_variable_ambiguity
```

## Data preservation evidence

Before and after migration:

```text
auth users: 3
projects:   10
goals:       3
tasks:     154
```

Post-reconciliation ownership:

```text
invalid project owners: 0
invalid goal owners or parent conflicts: 0
invalid task owners or parent conflicts: 0
```

The legacy orphaned project trees were assigned to the existing user resolved at runtime by `lower(email) = 'ab.mortaki@gmail.com'`. No generated user or row UUID was embedded in the migration. No row was deleted or copied between Supabase projects.

## Installed MCP database surface

Created:

- `public.mcp_authorization_grants`
- `public.mcp_rate_limit_windows`
- `public.custom_access_token_hook(jsonb)`
- `private.has_active_mcp_permission(text)`
- `public.consume_mcp_rate_limit(text, integer, integer)`

Extended:

- `public.agent_integration_events` with OAuth client, grant, request, tool, metadata, duration, and error evidence.

RLS enabled with reviewed policies on:

- `public.projects`
- `public.goals`
- `public.tasks`
- `public.mcp_authorization_grants`
- `public.mcp_rate_limit_windows`
- `public.agent_integration_events`
- `public.agent_integration_tokens`

## Direct-user RLS evidence

Synthetic JWT context for `ab.mortaki@gmail.com` returned only that account's rows:

```text
projects: 8
goals:    3
tasks:  143
```

Synthetic JWT context for the second populated account returned only its rows:

```text
projects: 2
goals:    0
tasks:   11
```

These counts total the unchanged production row counts and prove user isolation at the database policy boundary.

## OAuth RLS evidence

A temporary active read-only grant was created for a synthetic OAuth client and removed after the test.

With matching subject, client ID, and exact resource audience:

```text
projects visible: 8
 goals visible:   3
 tasks visible: 143
projects.read: true
goals.read:    true
tasks.read:    true
```

With the same subject/client but a different audience:

```text
projects visible: 0
goals visible:    0
tasks visible:    0
projects.read: false
```

## Custom Access Token Hook evidence

A temporary active grant was created and removed after the test. Calling `public.custom_access_token_hook` returned this exact audience:

```text
https://hook-preflight.ega-house.invalid/api/mcp
```

This proves the production hook implementation resolves active user/client grants and rewrites `aud` without the PostgreSQL 17 identifier ambiguity fixed in migration `0042`.

Post-test cleanup:

```text
mcp_authorization_grants: 0
mcp_rate_limit_windows:   0
agent_integration_events: 0
```

No temporary production test row remains.

## Advisor result

The MCP target tables and functions have no unexpected missing-RLS finding. The security advisor intentionally flags `consume_mcp_rate_limit` as an authenticated `SECURITY DEFINER` RPC; this is expected because the function derives identity from the verified JWT, validates an active exact-resource grant, validates bounded parameters, and is the only allowed client entry to the locked rate-limit table.

Pre-existing unrelated production findings remain:

- RLS disabled on several non-MCP public tables such as task sessions, week reviews, saved views, idea notes, recurrence/reminder, and calendar tables.
- `task_external_refs` has RLS enabled without a policy.
- `automation.set_updated_at` has a mutable search path.
- leaked-password protection is disabled.
- several existing foreign keys lack covering indexes.

These findings were not silently expanded into the MCP migration scope.

## Remaining activation gates

1. In `ofpqkogwatceimtzvenh`, enable Supabase OAuth 2.1 Server.
2. Set the authorization path to `/oauth/consent`.
3. Enable dynamic OAuth application registration.
4. Enable the Custom Access Token Hook using `public.custom_access_token_hook`.
5. Set the Site URL to the stable Vercel branch URL used by the MCP test.
6. Switch only the feature-branch Vercel Preview Supabase URL, publishable key, and secret key to `ofpqkogwatceimtzvenh`.
7. Redeploy Preview.
8. Connect a separate Hermes alias and perform real OAuth/tool/audit testing.
9. Keep `MCP_WRITES_ENABLED=false`.
10. Keep PR #112 in draft until the real production-project OAuth evidence is attached and reviewed.
