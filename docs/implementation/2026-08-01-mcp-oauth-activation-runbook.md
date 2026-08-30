# EGA House MCP OAuth — Activation and Rollback Runbook

Date: 2026-08-01
Branch: `feat/mcp-oauth-integration`
Pull request: `#112`
Production Supabase project: `ofpqkogwatceimtzvenh`
Free MCP staging Supabase project: `atmzqhpioaepykehjbui`

## Current safety state

- The MCP endpoint is disabled unless `MCP_ENABLED=true`.
- MCP writes remain disabled unless `MCP_WRITES_ENABLED=true`.
- The current implementation exposes four read-only tools only.
- No MCP migration has been applied to production.
- A separate free Supabase project is used for MCP staging instead of paid Supabase Branching.
- The staging project has the reviewed MCP schema, RLS policies, distributed limiter, OAuth server, Dynamic Client Registration, and Custom Access Token Hook enabled.
- The Vercel Preview environment for `feat/mcp-oauth-integration` overrides `NEXT_PUBLIC_SUPABASE_URL` to the staging project.
- Production data and policies remain unchanged.

## Free staging preview checkpoint

The current preview certification target is:

```text
Supabase project: atmzqhpioaepykehjbui
Supabase URL: https://atmzqhpioaepykehjbui.supabase.co
Vercel branch: feat/mcp-oauth-integration
Consent path: /oauth/consent
MCP path: /api/mcp
```

The consent page and approve/deny server flow are deployed on the branch preview. The next preview deployment must use the staging Supabase URL and publishable key before OAuth wire testing begins.

## Preconditions

Do not enable the production endpoint until every item below is complete:

1. GitHub MCP Integration CI is green for the exact branch head.
2. The free MCP staging project contains the reviewed schema and migrations.
3. Supabase security and performance advisors are reviewed after migration.
4. The Custom Access Token Hook is enabled for `public.custom_access_token_hook`.
5. Dynamic OAuth application registration is enabled for compatible MCP clients.
6. The Vercel Preview environment points to the staging Supabase project.
7. A trusted administrator creates an active, resource-bound authorization grant.
8. A real Supabase OAuth token proves the exact MCP resource in its `aud` claim.
9. MCP Inspector or an equivalent wire test proves discovery, authentication, tool listing, and all four read tools.
10. Rollback steps have been rehearsed against staging.

## 1. Staging Supabase project

Use the separate free staging project:

```text
atmzqhpioaepykehjbui
```

Never test these migrations directly on production first.

## 2. Applied staging migrations

The staging project contains the reviewed MCP foundation and hardening migrations:

```text
drizzle/0037_mcp_oauth_foundation.sql
drizzle/0038_mcp_read_only_rls.sql
drizzle/0039_mcp_grant_permission_consistency.sql
drizzle/0040_mcp_distributed_rate_limit.sql
drizzle/0041_mcp_security_performance_hardening.sql
```

Verify:

- `mcp_authorization_grants` has RLS enabled.
- Authenticated users can select only their own grants.
- Authenticated and anonymous roles cannot insert, update, or delete grants.
- `projects`, `goals`, and `tasks` have owner-scoped direct-user policies.
- OAuth reads require user, client, resource audience, active status, and permission match.
- `agent_integration_events` accepts OAuth client/grant audit events.
- `consume_mcp_rate_limit` is executable only by authenticated callers and uses JWT-derived identity.

## 3. Supabase OAuth settings

The staging project must keep all of the following enabled:

1. OAuth 2.1 Server.
2. Dynamic OAuth Apps.
3. Customize Access Token JWT Claims Hook.
4. Postgres function `public.custom_access_token_hook`.

The SQL function alone is not sufficient. Supabase Auth must be configured to call it.

## 4. Generate and commit database types

Generate TypeScript types from the migrated staging project and compare them with:

```text
src/lib/mcp/mcp-database.types.ts
```

Replace handwritten extensions where generated types are authoritative. Commit any type changes on the same feature branch and rerun CI.

## 5. Create a trusted authorization grant

Do not create or activate grants through a browser or OAuth bearer client. The OAuth consent server flow may activate only the exact read-only user/client/resource grant through its trusted administrative path.

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

Required Vercel Preview environment variables for `feat/mcp-oauth-integration`:

```text
MCP_ENABLED=true
MCP_WRITES_ENABLED=false
MCP_RESOURCE_URL=https://<stable-preview-host>/api/mcp
MCP_RESOURCE_DOCUMENTATION_URL=https://<stable-preview-host>/integrations/mcp
NEXT_PUBLIC_SUPABASE_URL=https://atmzqhpioaepykehjbui.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<staging publishable key>
SUPABASE_SERVICE_ROLE_KEY=<staging service-role key used only by the consent server path>
```

Security rules:

- Never put the service-role key in a `NEXT_PUBLIC_*` variable.
- Scope all staging values to Preview and the feature branch.
- Keep `MCP_WRITES_ENABLED=false`.
- Use one stable preview hostname for the Site URL, authorization resource, grant resource, and MCP resource.

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

Treat any missing RLS, overly broad policy, mutable search path, or unnecessarily exposed function warning as a release blocker. The reviewed `SECURITY DEFINER` rate-limit function is expected only when its body derives identity from verified JWT claims and validates the active grant.

## 9. Production promotion

Only after preview certification:

1. Review the exact migration diff again.
2. Confirm a recent production backup and rollback owner.
3. Apply the reviewed migrations through the normal deployment path.
4. Enable OAuth Server, Dynamic OAuth Apps, and the Custom Access Token Hook in production.
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
- Update the PR body with the exact final SHA, CI run, staging project reference, migration evidence, and wire-test evidence.
- Keep the PR draft until OAuth wire proof is attached.

### Supabase

- Treat production as immutable until staging proof is complete.
- Record staging project ID, applied migration versions, hook configuration, generated type hash, advisor results, and rollback rehearsal.

### Notion

Append a dated implementation-review section containing:

- Branch and PR.
- Final commit SHA.
- Web standards reviewed.
- Security defects found and fixed.
- CI and dependency-audit results.
- Staging Supabase project and configuration state.
- Supabase production status.
- Remaining activation evidence.

## External standards reviewed

- MCP Authorization specification: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
- Supabase OAuth server: https://supabase.com/docs/guides/auth/oauth-server
- Supabase Custom Access Token Hook: https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook
- Supabase Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Next.js Proxy convention: https://nextjs.org/docs/app/api-reference/file-conventions/proxy
