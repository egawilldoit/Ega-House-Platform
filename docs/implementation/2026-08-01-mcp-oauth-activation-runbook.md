# EGA House MCP OAuth — Activation and Rollback Runbook

Date: 2026-08-01  
Branch: `feat/mcp-oauth-integration`  
Pull request: `#112`  
Production Supabase project: `ofpqkogwatceimtzvenh`

## Current safety state

- The MCP endpoint is disabled unless `MCP_ENABLED=true`.
- MCP writes remain disabled unless `MCP_WRITES_ENABLED=true`.
- The current implementation exposes four read-only tools only.
- No MCP migration has been applied to production.
- No Supabase development branch has been created.
- Production data and policies remain unchanged.

## Preconditions

Do not enable the endpoint until every item below is complete:

1. GitHub MCP Integration CI is green for the exact branch head.
2. A Supabase development branch has been explicitly cost-approved and created.
3. Migrations `0037` through `0040` pass on that development branch.
4. Supabase security and performance advisors are reviewed after migration.
5. The Custom Access Token Hook is enabled for `public.custom_access_token_hook`.
6. A trusted administrator creates an active, resource-bound authorization grant.
7. A real Supabase OAuth token proves the exact MCP resource in its `aud` claim.
8. MCP Inspector or an equivalent wire test proves discovery, authentication, tool listing, and all four read tools.
9. The endpoint is enabled in preview before production.
10. Rollback steps have been rehearsed against the development branch.

## 1. Create the Supabase development branch

The last observed branch price was **USD 0.01344 per hour**. Obtain a fresh price and explicit cost confirmation before creating the branch.

Recommended branch name:

```text
mcp-oauth-integration
```

Never test these migrations directly on production first.

## 2. Apply migrations on the development branch

Apply in this order:

```text
drizzle/0037_mcp_oauth_foundation.sql
drizzle/0038_mcp_read_only_rls.sql
drizzle/0039_mcp_grant_permission_consistency.sql
drizzle/0040_mcp_distributed_rate_limit.sql
```

Verify:

- `mcp_authorization_grants` has RLS enabled.
- Authenticated users can select only their own grants.
- Authenticated and anonymous roles cannot insert, update, or delete grants.
- `projects`, `goals`, and `tasks` have owner-scoped direct-user policies.
- OAuth reads require user, client, resource audience, active status, and permission match.
- `agent_integration_events` accepts OAuth client/grant audit events.
- `consume_mcp_rate_limit` is executable only by authenticated callers and uses JWT-derived identity.

## 3. Enable the Supabase Custom Access Token Hook

In the development project dashboard:

1. Open **Authentication**.
2. Open **Hooks**.
3. Enable the **Custom Access Token Hook**.
4. Select `public.custom_access_token_hook`.
5. Save the configuration.

The SQL function alone is not sufficient. Supabase Auth must be configured to call it.

## 4. Generate and commit database types

Generate TypeScript types from the migrated development branch and compare them with:

```text
src/lib/mcp/mcp-database.types.ts
```

Replace handwritten extensions where generated types are authoritative. Commit any type changes on the same feature branch and rerun CI.

## 5. Create a trusted authorization grant

Do not create or activate grants through a browser or OAuth bearer client. Use a trusted administrative path.

Required fields:

```text
owner_user_id
oauth_client_id
resource_uri
status = active
permission_profile = read_only
permissions = [projects.read, goals.read, tasks.read]
permissions_version = 1
approved_at
```

`resource_uri` must exactly equal the deployed MCP URL, for example:

```text
https://<preview-host>/api/mcp
```

## 6. Configure the preview deployment

Required environment variables:

```text
MCP_ENABLED=true
MCP_WRITES_ENABLED=false
MCP_RESOURCE_URL=https://<preview-host>/api/mcp
MCP_RESOURCE_DOCUMENTATION_URL=https://<preview-host>/integrations/mcp
NEXT_PUBLIC_SUPABASE_URL=https://<development-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<development publishable key>
```

Do not provide a Supabase service-role key to the MCP runtime.

## 7. Prove OAuth and MCP behavior

Capture evidence for each case:

- Protected Resource Metadata returns the canonical resource and Supabase issuer.
- Missing bearer token returns `401` with `resource_metadata` in `WWW-Authenticate`.
- Invalid token returns a redacted `401`.
- Valid Supabase token without an active EGA grant returns `403`.
- Active resource-bound grant produces a token whose `aud` equals the MCP resource.
- A token for another resource is rejected.
- `ega_get_capabilities` returns the `read_only` profile.
- Project, goal, and task results are owner-scoped.
- Unsupported status, priority, UUID, limit, and unknown arguments are rejected.
- Rate limiting returns a stable denial and retry duration.
- Every tool call creates one token-free audit event with request ID, tool, outcome, duration, client ID, and grant ID.
- GET is rejected for this JSON-only stateless deployment; POST is the supported MCP transport.

## 8. Review Supabase advisors

Run both advisor classes after migration:

```text
security
performance
```

Treat any missing RLS, overly broad policy, mutable search path, or exposed function warning as a release blocker.

## 9. Production promotion

Only after preview certification:

1. Review the exact migration diff again.
2. Confirm a recent production backup and rollback owner.
3. Merge the Supabase development branch or apply the reviewed migrations through the normal deployment path.
4. Enable the Custom Access Token Hook in production.
5. Generate production types and compare for drift.
6. Deploy with `MCP_ENABLED=false` first.
7. Run discovery and unauthenticated boundary checks.
8. Set `MCP_ENABLED=true` only during a monitored release window.
9. Keep `MCP_WRITES_ENABLED=false`.
10. Re-run the OAuth and MCP evidence matrix against production.

## Rollback

Immediate application rollback:

```text
MCP_ENABLED=false
MCP_WRITES_ENABLED=false
```

Then:

1. Disable the Supabase Custom Access Token Hook.
2. Revoke active MCP grants by setting `status='revoked'` and `revoked_at=now()` through the trusted admin path.
3. Confirm `/api/mcp` returns the disabled response.
4. Preserve audit events and rate-limit evidence for investigation.
5. Do not drop tables during the incident window.
6. Roll back RLS policies only with a reviewed migration that restores the previous owner-isolation behavior.

## Update responsibilities

### GitHub

- Keep implementation, migrations, tests, dependency lockfile, and this runbook in PR `#112`.
- Update the PR body with the exact final SHA, CI run, Supabase branch reference, migration evidence, and wire-test evidence.
- Keep the PR draft until development-branch migration and OAuth wire proof are attached.

### Supabase

- Treat production as immutable until development-branch proof is complete.
- Record branch ID, applied migration versions, hook configuration, generated type hash, advisor results, and rollback rehearsal.

### Notion

Append a dated implementation-review section containing:

- Branch and PR.
- Final commit SHA.
- Web standards reviewed.
- Security defects found and fixed.
- CI and dependency-audit results.
- Supabase production status.
- Development-branch cost and approval state.
- Remaining activation evidence.

## External standards reviewed

- MCP Authorization specification: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
- Supabase OAuth server: https://supabase.com/docs/guides/auth/oauth-server
- Supabase Custom Access Token Hook: https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook
- Supabase Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Next.js ESLint migration: https://nextjs.org/docs/app/api-reference/config/eslint
