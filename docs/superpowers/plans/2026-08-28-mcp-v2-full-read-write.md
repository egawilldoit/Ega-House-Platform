# Plan — MCP v2 full read/write — 2026-07-28

**Branch:** `feat/mcp-v2-full-read-write`
**Base:** `1a01bf3`
**SDK:** `@modelcontextprotocol/server` `2.0.0`, `@modelcontextprotocol/client` `2.0.0`, `@modelcontextprotocol/core` `2.0.0`
**Protocol:** `2026-07-28`

## Waves

### Wave 0 — Baseline (this doc + design + evidence)

- W0-T1..T8: inventory, baseline validation, design synthesis

### Wave 1-2 — SDK v2 transport

- Codemod `v1-to-v2`, manual migration, `createMcpHandler`, stateless per-request, Host/Origin via `enableDnsRebindingProtection`, verify `MCP-Protocol-Version`/`Mcp-Method`/`Mcp-Name` are validated not authorized, `server/discover`, no Mcp-Session-Id, legacy stateless fallback.

### Wave 3 — Auth/grants

- Add `workspace_manager` profile, separate `MCP_AUTHORIZED_SCOPE` (`ega.mcp.authorized`) from EGA permissions (JWT `permissions` array). Grant persistence via upsert on `(owner, client)`, versioned `permissions_version`. Consent page offers `read_only` vs `workspace_manager` when `MCP_WRITES_ENABLED=true`.

### Wave 4 — RLS/write security

- New policies: `*_mcp_write_access` gated on `private.has_active_mcp_permission('tasks.create')` etc. Check with `WITH CHECK owner=auth.uid() && client_id IS NOT NULL && has_permission`. Migration `0045_mcp_write_rls.sql`. Private helper overload for write permissions.

### Wave 5 — Reads

- Permission-aware registry: filter tools/list by principal permissions. Strict zod schemas, strip `ownerUserId`. Reads call `application` read models via `createMcpSupabaseClient(token)` → RLS.

### Wave 6-7 — Writes

- Handler shape: `validated input → requireMcpPermission → AuthenticatedActor{userId: principal.ownerUserId} → application.service → repository → RLS → structured result (entity or post-read)`. Return `CallToolResult` with `structuredContent`.
- Today = projection over tasks (`planned_for_date`); timer enforces `task_sessions_owner_open_unique`.

### Wave 8 — MRTR

- `MCP_REQUEST_STATE_SECRET` env (32+ bytes), `createRequestStateCodec({key, ttlSeconds: 300, bind: {user, client, grant/version, resource, tool, operationId, argsHash, target, phase}})`. `input_required` via official helper, typed input validation, cross-instance (stateless + HMAC), revalidate grant/ownership between rounds, decline = no mutation, tamper = 32602.

### Wave 9 — Reliability

- `mcp_mutation_receipts` table (owner, client, tool, operation_id, args_hash, result, created_at) — inserted before mutation, updated after. Concurrency via `INSERT ... ON CONFLICT DO NOTHING` + `SELECT FOR UPDATE` or `pg_advisory_xact_lock`. Audit: durable ledger write before success return; rate limits via `consume_mcp_rate_limit` with per-tool limits (reads 120/60s, writes 30/60s).

### Wave 10 — Docs/ops

- `server/discover` with ttl 0/private, private permission-sensitive caching (`Cache-Control: private, no-store` on tools/list when auth’d). Runbook: `MCP_WRITES_ENABLED=false` then revoke grant or rollback revision. No destructive down migration.

### Wave 11 — E2E (A-Q)

- Use `@modelcontextprotocol/client` `StreamableHTTPClientTransport` against `handler.fetch`. Scenarios as per prompt §30. Full local validation: typecheck + web:test + architecture + ci:purity/security/workspace + validate:agent-context.

### Wave 12-15 — Audits & fixes

- 7 reviewers each audit, P0-P2 must be 0 before Done, reports in `docs/reports/`.

## Rollback

1. Set `MCP_WRITES_ENABLED=false` (immediate, no deploy)
2. If needed revoke `mcp_authorization_grants` row (status='revoked')
3. If needed revert app revision
4. No DB down migration (write RLS policies remain, they just gate)

## Risks

- SDK codemod misses DI factories → grep `setRequestHandler` + `extra.`
- zid nested copies if workspace pins zod 3 → check bundler `manualChunks`
- Consent UX must not silently elevate existing grants
