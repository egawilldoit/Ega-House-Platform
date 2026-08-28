# Runbook — MCP v2 read/write (2026-07-28)

**Branch:** `feat/mcp-v2-full-read-write`
**SDK:** `@modelcontextprotocol/server` 2.0.0, `@modelcontextprotocol/client` 2.0.0, `@modelcontextprotocol/core` 2.0.0
**Protocol:** `2026-07-28` (stateless `createMcpHandler`, `server/discover`, `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name`, `Mcp-Param-*`)

## Serving

- **Endpoint:** `POST /api/mcp` — stateless, fresh `McpServer` per request, `sessionIdGenerator: undefined`, `enableDnsRebindingProtection: true`, `allowedHosts: [resource.host]`, `allowedOrigins: [resource.origin]`
- **Headers validated, not authorized:** `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name`, `Mcp-Param-*` are checked against body by the transport/handler (400 + `-32020` on mismatch), never used as auth source. Auth is `Authorization: Bearer <Supabase JWT>` → `verifyAccessToken` → `loadActiveMcpGrant` → `principal` → `MCP_AUTHORIZED_SCOPE` + permission checks + RLS.
- **No session id:** `Mcp-Session-Id` never required; `GET /api/mcp` returns 405 (stateless).
- **Discovery:** `server/discover` is served by `createMcpHandler` (modern) with `ttlMs: 0`, `cacheScope: private` (most conservative). Client `getServerVersion()` reads `_meta['io.modelcontextprotocol/serverInfo']`. Until full `createMcpHandler` cutover, legacy `WebStandardStreamableHTTPServerTransport` serves 2025-era `initialize`; modern `server/discover` is handled by the new handler entry (see route-runtime).
- **Legacy fallback:** `legacy: 'stateless'` (default) also serves 2025-era traffic stateless; `isLegacyRequest(request)` (no `_meta` envelope) routes to legacy path — modern malformed envelope → `-32020`.

## Authorization

- **OAuth:** Supabase OAuth, `aud` = `resource` = `MCP_RESOURCE_URL`, `client_id` from JWT, `mcp_authorization_grants` (owner, client, resource, profile, permissions, version, status)
- **Profiles:** `read_only` (5 reads), `task_manager` (reads + tasks.create/update), `delivery_observer`, `workspace_manager` (full 14). `MCP_WRITES_ENABLED` global kill switch gates all writes even when grant permits.
- **Consent:** `/oauth/consent?authorization_id=...` shows Read-only vs Workspace management when `MCP_WRITES_ENABLED=true`; otherwise only Read-only. User explicitly picks; no silent elevation of existing grants.
- **RLS:** `private.has_active_mcp_permission(perm)` checks `auth.uid()`, `client_id`, `aud`, `status='active'`, `permissions @> [perm]`. Policies:
  - `*_select_access`: owner + (client null OR has read perm)
  - `*_mcp_insert_access` / `*_update` / `*_delete`: owner + client not null + has create/update perm
  - `task_sessions`/`task_reminders` similarly gated on `timer.*` / `tasks.update`
  - Direct user (`client_id IS NULL`) retains `ALL` access; `authenticated` without grant → 403; anon → 0.

## MRTR / requestState

- **Secret:** `MCP_REQUEST_STATE_SECRET` env, min 32 bytes (base64 or utf8), shared across all stateless instances, never logged/committed.
- **Codec:** `createRequestStateCodec({key, ttlSeconds: 300})` → `{mint, verify}` HMAC-SHA256 over `base64url(json{ p, exp })`. Verify uses `timingSafeEqual`, checks expiry.
- **Binding:** `p` should contain `{user, client, grantId, grantVersion, resource, tool, operationId, argsHash, targetId?, phase, exp}` — mint on `input_required` return, verify on retry.
- **Flow:** handler returns `inputRequired({ inputRequests: {confirm: inputRequired.elicit({message})}, requestState: await codec.mint(bound) })`; client retries with `inputResponses` + `requestState`; handler re-enters, reads `ctx.mcpReq.requestState<T>()` and `ctx.mcpReq.inputResponses`, revalidates grant/ownership/target before mutating. Decline → no mutation; tamper/expiry → `-32602`; grant revoked between rounds → `PERMISSION_DENIED`.
- **Cross-instance:** stateless + HMAC → any instance can verify.

## Idempotency

- **Ledger:** `mcp_mutation_receipts(owner, client, tool, operation_id, args_hash, result_payload)` PK(owner,client,tool,opId). `mcp_claim_mutation_receipt(tool, opId, argsHash)` does `INSERT ON CONFLICT DO NOTHING` → fetch → if argsHash mismatch → conflict (409), if result present → replay, else proceed. Caller must then `mcp_store_mutation_result(tool, opId, result)` after mutation.
- **Key:** `(owner, oauth_client_id, tool, operationId)` — same args → stable replay; different args → rejected; concurrent duplicates → exactly one effect (ON CONFLICT).
- **All writes** require `operationId` (uuid v4) — `createTask`, `startTimer`, `stopTimer` enforce; others optional but recommended.

## Audit / Rate limits

- **Audit:** `agent_integration_events` with `grant_id`, `toolName`, `outcome`, `durationMs`, `metadata{resultCount, retryAfter, operationId}`. Mutation path writes receipt before success, so audit failure does not cause duplicate (retry replays receipt).
- **Rate limits:** `consume_mcp_rate_limit(tool, limit, window)` SECURITY DEFINER, checks grant existence, fixed window per (owner,client,tool). Default: reads 120/60s, writes 30/60s. `auditedReadHandlers` already wraps reads; writes to use same.

## Rollback

1. **Immediate kill:** `MCP_WRITES_ENABLED=false` (env, no deploy). Writes now return `WRITES_DISABLED` even with workspace_manager grant.
2. **Revoke grant:** `UPDATE mcp_authorization_grants SET status='revoked', revoked_at=now() WHERE owner_user_id=... AND oauth_client_id=...` (if needed).
3. **Rollback app revision:** revert to previous `feat/mcp-v2-full-read-write` predecessor or `main` (no DB down migration). Write RLS policies remain but now gate (no writes).
4. **No destructive down migration:** `mcp_mutation_receipts` and write policies stay; they are harmless when writes disabled.

## Production actions NOT performed (per boundary)

- Migrations `0045..0047` not applied to production DB (local/journal only).
- `MCP_REQUEST_STATE_SECRET` not rotated in prod (to be set out-of-band before cutover).
- PR not merged (`feat/mcp-v2-full-read-write` → `main`).

## Monitoring

- Check `agent_integration_events` by `grant_id`/`toolName` for 4xx/5xx spikes.
- Watch `mcp_rate_limit_windows` for throttling.
- Alert on `mcp_mutation_receipts` conflict rate.

## SDK & protocol proof

- `apps/web/package.json`: `@modelcontextprotocol/server/client/core` 2.0.0
- `apps/web/src/lib/mcp/server.ts`: `registerMcpWriteTools`, `ServerContext` (`ctx.http.authInfo`, `ctx.mcpReq.id`), strict zod 4 schemas
- `apps/web/src/lib/mcp/request-state.ts`: `createRequestStateCodec`
- `drizzle/` migrations: `0045..0047` + `meta/_journal.json`
- `npm run web:typecheck` PASS, `web:test` 1009 PASS, `check:architecture` PASS
