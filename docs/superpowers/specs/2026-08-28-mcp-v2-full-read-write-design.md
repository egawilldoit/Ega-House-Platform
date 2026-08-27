# Spec — MCP v2 full read/write (2026-07-28)

## Target architecture

```
MCP client (v2, 2026-07-28)
  → POST /api/mcp (stateless)
    → withEgaMcpAuth (Bearer → verifyAccessToken → loadActiveMcpGrant → principal)
      → createMcpHandler(factory) per request
        → permissionAwareRegistry(principal) → tools/list filtered
        → tool execution guard (requireMcpPermission + MCP_WRITES_ENABLED)
        → audited handler wrapper (rate limit + audit ledger)
        → AuthenticatedActor{userId: principal.ownerUserId}
        → @ega/application use case
        → @ega/data-access Supabase adapter (request-scoped client with bearer)
        → PostgREST → RLS (private.has_active_mcp_permission)
        → Postgres
```

## Tool catalog

### Reads (read_only and above)

- `ega_get_capabilities` — returns profile, version, permissions, writesEnabled
- `ega_list_projects` — limit 1-100
- `ega_list_goals` — projectId?, limit
- `ega_list_tasks` — projectId?, goalId?, status?, priority?, includeArchived?, limit
- `ega_get_task` — taskId (new)
- `ega_get_today_plan` — date? (today plan)
- `ega_list_timer_sessions` — limit, mode open/recent

### Writes (workspace_manager only, when MCP_WRITES_ENABLED)

- `ega_create_project` — name, slug, description?
- `ega_update_project_status` — projectId, status
- `ega_archive_project` / `ega_unarchive_project`
- `ega_create_goal` — title, projectId, description?, nextStep?, health?, status?, slug?
- `ega_update_goal_status|health|next_step` — goalId, value
- `ega_create_task` — title, projectId, goalId?, description?, status?, priority?, dueDate?, estimateMinutes?, plannedForDate?
- `ega_update_task` — taskId + patch fields
- `ega_archive_task` / `ega_unarchive_task`
- `ega_set_task_focus_rank`
- `ega_plan_task_for_today` / `ega_remove_task_from_today`
- `ega_update_today_task_status`
- `ega_clear_completed_today` — date, requires MRTR confirmation
- `ega_start_timer` — taskId, operationId
- `ega_stop_timer` — sessionId or taskId, operationId

All writes require `operationId` (uuid v4) for idempotency, except status updates where caller may omit for simple cases (server generates but warns).

## Permission catalog

```
read_only: projects.read, goals.read, tasks.read, today.read, timer.read
workspace_manager: + projects.create, projects.update, goals.create, goals.update, tasks.create, tasks.update, today.update, timer.create, timer.update
delivery_observer: delivery_runs.read, delivery_events.read, delivery_artifacts.read
```

`MCP_WRITES_ENABLED` gates all `*.create/update` regardless of grant.

## OAuth model

- OAuth is Supabase OAuth (Authorization Code + PKCE, third-party client)
- `aud` = `resource` = `MCP_RESOURCE_URL` (e.g. https://ega.example.com)
- `client_id` from JWT claim
- `mcp_authorization_grants` row (owner, client, resource, profile, permissions, version, status)
- `custom_access_token_hook` injects `aud` into JWT on exchange
- Consent page: shows requested EGA permissions (not raw OAuth scopes), user picks Read-only vs Workspace management. Workspace option disabled when `MCP_WRITES_ENABLED=false`. On approve → `activateMcpGrant(admin, {owner, client, resource, profile, permissions})` via `supabase_auth_admin`.

## RLS model (migration 0045)

- Keep existing `*_select_access` policies (OR client null or has read perm)
- Add `*_insert_access`, `*_update_access`, `*_delete_access` for MCP:
  ```
  USING/WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt())->>'client_id') IS NOT NULL
    AND private.has_active_mcp_permission('<perm>')
  )
  ```
- Separate policies per operation so read-only grants cannot insert. Anonymous still blocked via RESTRICTIVE deny.
- Direct user path unchanged: client_id IS NULL.

## MRTR

- Secret: `MCP_REQUEST_STATE_SECRET` env, 32+ bytes, base64 or hex, shared across instances, never logged.
- Codec: `createRequestStateCodec({key, ttlSeconds: 300})` → {mint, verify} using HMAC-SHA256 over JSON(payload) + expiry + binding hash.
- Binding: `requestState = HMAC({user, client, grantId, grantVersion, resource, tool, operationId, argsHash, targetId?, phase, exp})`
- `inputRequired` helper from `@modelcontextprotocol/server`: `return inputRequired({inputRequests: {confirm: inputRequired.elicit({message: "Clear 12 completed tasks for 2026-08-28?"})}, requestState: await codec.mint(boundState)})`
- Handler re-entered via same `tools/call`, reads `ctx.mcpReq.inputResponses`, `ctx.mcpReq.requestState<T>()`, validates, rechecks grant/permissions/ownership/target state, then mutates or cancels.
- Unsupported client: explicit `input_required` explains capability; no fallback that mutates without confirmation.
- Stale authority: on re-entry, reload grant, compare version/status, reject with `PERMISSION_DENIED` if revoked,  no mutation.

## Idempotency

- Table `mcp_mutation_receipts(owner_user_id, oauth_client_id, tool_name, operation_id, args_hash, result_payload, created_at, updated_at)` primary key (owner, client, tool, operation_id)
- Flow: `SELECT receipt` if found and argsHash==current → replay; if hash mismatch → error; if not found → `INSERT ... ON CONFLICT DO NOTHING` then proceed; after mutation `UPDATE receipt SET result=payload`
- Concurrency: `pg_advisory_xact_lock(hashtext(owner||client||tool||opId))` or `INSERT` race yields exactly one winner.

## Audit

- `agent_integration_events` already exists for MCP: insert with `owner, tokenId/grantId, action=toolName, resourceType, outcome, metadata:{resultCount | retryAfter | operationId}`
- Mutation path: write receipt first, then audit after mutation success; if audit fails, receipt still holds result so retry replays rather than duplicates.
- Rate limit: extend `consume_mcp_rate_limit` calls with per-tool limits (reads 120/min, writes 30/min, MRTR 60/min).

## Compatibility

- Legacy clients without `_meta` envelope → `isLegacyRequest` false? Modern probe: requests with envelope claim are modern; missing envelope dispatch to legacy stateless fallback (existing `WebStandardStreamableHTTPServerTransport` path) for graceful fallback until 2026 migration completes.
- No `Mcp-Session-Id`.
- `MCP-Protocol-Version` required on modern, rejected 400 if mismatch body vs header.

## Non-goals

- MCP Tasks extension not implemented
- No service-role bypass
- No caller-owned user selection
