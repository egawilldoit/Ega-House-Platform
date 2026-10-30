# Runbook — MCP v2 read/write (2026-08-29)

**Branch:** `feat/mcp-v2-full-read-write` (original authoring branch); refreshed against repository state `16e22cd9` on 2026-10-05
**SDK:** `@modelcontextprotocol/server` **2.3.0**, `@modelcontextprotocol/client` **2.3.0**, `@modelcontextprotocol/core` **2.3.0** (per `apps/web/package.json`; this line previously said 2.0.0)
**Protocol:** `2026-07-28` only (stateless `createMcpHandler`, `legacy: 'reject'`, `server/discover`, `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name`, `Mcp-Param-*`)

## Serving

- **Endpoint:** `POST /api/mcp` — stateless, fresh `McpServer` per request, `sessionIdGenerator: undefined`, `enableDnsRebindingProtection: true`, `allowedHosts: [resource.host]`, `allowedOrigins: [resource.origin]`
- **Headers validated, not authorized:** `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name`, `Mcp-Param-*` are checked against body by the transport/handler (400 + `-32020` on mismatch), never used as auth source. Auth is `Authorization: Bearer <Supabase JWT>` → `verifyAccessToken` → `loadActiveMcpGrant` → `principal` → `MCP_AUTHORIZED_SCOPE` + permission checks + RLS.
- **No session id:** `Mcp-Session-Id` never required; `GET /api/mcp` returns 405 (stateless).
- **Discovery:** `server/discover` is served by the single modern `createMcpHandler` path with `legacy: 'reject'`, `ttlMs: 0`, and `cacheScope: private` (most conservative). Client `getServerVersion()` reads `_meta['io.modelcontextprotocol/serverInfo']`. `MCP-Protocol-Version` is required and must be `2026-07-28`; 2025-era initialize/stateless requests and missing-header requests are rejected.

## Authorization

- **OAuth:** Supabase OAuth, `aud` = `resource` = `MCP_RESOURCE_URL`, `client_id` from JWT, `mcp_authorization_grants` (owner, client, resource, profile, permissions, version, status)
- **Profiles:** `read_only` (7 read tools), `task_manager` (7 reads + 7 task-management writes = 14), `workspace_manager` (all 30 tools when writes are enabled). `delivery_observer` is retired. `MCP_WRITES_ENABLED` global kill switch gates all writes even when grant permits.
- **Permission version:** grants are issued at `permissions_version 1`; v2 is defined and frozen in both `permissions.ts` and `drizzle/0066` but **not issued**, so the v2 read permissions (friction/inbox/notifications/operator/workload) authorize nothing today and have no tool behind them.
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

## Idempotency and domain fencing

- **Ledger:** `mcp_mutation_receipts(owner, client, tool, operation_id, args_hash, result_payload)` PK(owner,client,tool,opId). `mcp_claim_mutation_receipt(tool, opId, argsHash)` does `INSERT ON CONFLICT DO NOTHING` → fetch → if argsHash mismatch → conflict (409), if result present → replay, else proceed. Caller must then `mcp_store_mutation_result(tool, opId, result)` after mutation.
- **Key:** `(owner, oauth_client_id, tool, operationId)` — same canonical args → stable replay; different args → rejected before the business mutation; concurrent duplicates → one receipt winner.
- **All writes** require `operationId` (UUID v4). The server derives owner and client from the verified MCP principal; neither is accepted from tool arguments.
- **Create-domain fence:** migration `0059_mcp_domain_operation_fencing` adds `(owner_user_id, mcp_client_id, mcp_operation_id)` partial unique indexes to `projects`, `goals`, `tasks`, `task_reminders`, and `task_sessions`. The application propagates the identity to the repository, and the repository recognizes only the matching named `23505` collision before loading the canonical row through the request-scoped RLS client.
- **Crash boundary:** if the domain INSERT commits and the process dies before receipt storage, a fresh claim retries the INSERT, receives the named domain collision, and returns the original project, goal, task, reminder/task, or session. Unrelated unique violations remain failures.
- **Create guarantee:** projects, goals, tasks, task reminders, and task sessions are exactly-once across normal retries, concurrency, receipt loss, lease expiry, and stale-worker recovery when the request uses the same authenticated owner, client, tool, operation ID, and canonical arguments.
- **Update guarantee:** state/projection updates remain at-least-once but idempotent. This runbook makes no broader exactly-once claim for updates.

## Audit / Rate limits

- **Audit:** `agent_integration_events` with `grant_id`, `toolName`, `outcome`, `durationMs`, `metadata{resultCount, retryAfter, operationId}`. MCP OAuth audit persistence uses migration `0061_mcp_audit_event_rpc`: a claim-bound `SECURITY DEFINER` RPC derives owner/client/resource and the active grant from JWT context while direct OAuth table INSERT remains blocked. Mutation path writes receipt before success, so audit failure does not cause duplicate (retry replays receipt).
- **Rate limits:** `consume_mcp_rate_limit(window_name)` SECURITY DEFINER, checks grant existence, fixed window per `(owner, client, window name)`. **Default: 120/60s for every tool** — this line previously claimed `reads 120/60s, writes 30/60s` and that write path never existed. Each permitted call also consumes a risk-class aggregate bucket (`ega_aggregate_read` 600/60s, `ega_aggregate_write` 300/60s, `ega_aggregate_sensitive_write` 60/60s) so total throughput cannot multiply as the tool count grows; at this revision those three buckets contain 7, 22 and 1 capability respectively, because `ega_clear_completed_today` is the only `sensitive_write`. The allowance and window length are derived inside the RPC and are **not** caller-supplied: until `drizzle/0071` both were arguments, and because the conflict handler treats a window mismatch as a fresh bucket one extra RPC call reset the counter while `p_limit=10000` disabled the limit outright. The three-argument overload is dropped, so passing a limit or window now fails rather than quietly succeeding. Both numbers are enforced values; only the *choice* of those values is an open product decision, and it is recorded as such in [`ARCHITECTURE.md`](../../ARCHITECTURE.md). `auditedReadHandlers` already wraps reads; writes to use same.

## Rollback

1. **Immediate kill:** `MCP_WRITES_ENABLED=false` (env, no deploy). Writes now return `WRITES_DISABLED` even with workspace_manager grant.
2. **Revoke grant:** `UPDATE mcp_authorization_grants SET status='revoked', revoked_at=now() WHERE owner_user_id=... AND oauth_client_id=...` (if needed).
3. **Rollback app revision:** revert to previous `feat/mcp-v2-full-read-write` predecessor or `main` (no DB down migration). Write RLS policies remain but now gate (no writes).
4. **No destructive down migration:** `mcp_mutation_receipts` and write policies stay; they are harmless when writes disabled.

## Product client boundary

MCP transport is web-only at `POST /api/mcp`. `apps/mobile` does not
implement MCP transport or tool discovery. Mobile continues to use the shared
product API through `@ega/api-client` → `apps/server`; MCP-created project,
goal, task, reminder, and session rows are visible to the same authenticated
mobile user through those owner-scoped APIs.

## Production deployment notes

- Migrations `0050..0081` are the MCP tail after current-main migrations `0045..0049`; the shipped journal ends at `0081_mcp_write_fence_state_transitions` (this document previously said `0050..0061`, then `0050..0072`). Production application status is verified from the target database migration history before deployment — the repository journal says what has been *written*, never what has been *applied*.
- `MCP_REQUEST_STATE_SECRET` not rotated in prod (to be set out-of-band before cutover).
- Production deployment and migration status are operational evidence, not inferred from this runbook; verify the target database and Vercel deployment before declaring rollout complete.

## Monitoring

- Check `agent_integration_events` by `grant_id`/`toolName` for 4xx/5xx spikes.
- Watch `mcp_rate_limit_windows` for throttling.
- Alert on `mcp_mutation_receipts` conflict rate.

## SDK & protocol proof

- `apps/web/package.json`: `@modelcontextprotocol/server/client/core` **2.3.0** (all three pinned exactly, no range)
- `apps/web/src/lib/mcp/capability-registry.ts`: the canonical `MCP_CAPABILITIES` array — 30 entries (7 read, 23 write), the single source for discovery, registration eligibility, risk class and annotations
- `apps/web/src/lib/mcp/permissions.ts`: `MCP_PERMISSION_VERSIONS = [1, 2]`, `CURRENT_MCP_PERMISSION_VERSION = 1` (v2 defined, not issued)
- `apps/web/src/lib/mcp/server.ts`: `registerMcpWriteTools`, `ServerContext` (`ctx.http.authInfo`, `ctx.mcpReq.id`), strict zod 4 schemas, 30 `registerTool` calls pinned to the registry by `capability-registry-migration.test.ts`
- `apps/web/src/lib/mcp/request-state.ts`: `createRequestStateCodec`
- `drizzle/` migrations: current-main `0045..0049` plus MCP `0050..0081` + `meta/_journal.json` (81 entries, last `idx: 80`; the tag sequence skips `0075`)
- Database behaviour of every fence above is proven by the `scripts/db/*.mjs` ephemeral-database verifiers, not by the application tests; see the table in [`ARCHITECTURE.md`](../../ARCHITECTURE.md). Each takes `--url <postgres-url>`, `exit 2` without it, and each begins by `DROP SCHEMA … CASCADE` on `public`, `auth` and `automation` — so every schema in the named database is destroyed. Point them only at a disposable container.
- Final command results are recorded in the delivery report; this document does not substitute for executed evidence.
