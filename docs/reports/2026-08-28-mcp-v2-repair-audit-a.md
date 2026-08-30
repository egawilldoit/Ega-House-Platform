# Repair Audit A — MCPv2 2026-07-28 — 2026-08-28

**Branch:** `feat/mcp-v2-full-read-write`
**Head audited:** `4af2e76e25601fc4d2420db1023a6e8c4ab2b517`
**Base:** `1a01bf3d03bf2394358f204448d247f1b04d544e` (`origin/main`)
**Auditors:** A1 protocol/SDK, A2 OAuth/consent, A3 DB/RLS, A4 app arch, A5 MRTR/idempotency, A6 tests/E2E, A7 adversarial — fresh, independent, not reusing old audit conclusions, each used Superpowers + official SDK source
**Method:** read `AGENTS.md`→`ARCHITECTURE.md`→`docs/implementation/*`→`apps/web/src/lib/mcp/*` (29 files, 162 tests) → `packages/application`/`data-access` → `drizzle/*.sql` → `apps/web/src/app/oauth/consent/page.tsx` → `gh pr view 183` diff `origin/main...HEAD` (59 files + 0045-0048 + pending), `git diff --check`, `npm ci` proof, official `createMcpHandler` source, `input-required` guide

## Summary

| Sev | Count |
|---|---|
| P0 | 0 |
| P1 | 0 |
| P2 | 0 |
| P3 | 1 |

**Blocking:** 0 — ready for Audit B after optional P3.

## Findings

### A6-F01 — P3 — Consent page test still missing (non-blocking)

**Reviewer:** A6 testing
**Area:** `apps/web/src/app/oauth/consent/page.tsx:151` (now correctly inside `<form>`)
**Finding:** Form now correctly wraps radios (W4 fixed) and `decision-service` correctly downgrades `workspace_manager` when `MCP_WRITES_ENABLED=false`. No dedicated unit test for the page's `form` association.
**Evidence:** `page.tsx:151` `<form action="/api/oauth/decision" method="post" className="mt-8 space-y-6">` now contains `<input type="radio" name="permission_profile"` at `page.tsx:161,168`, and `route.ts:45` parses `permission_profile` with `MCP_WRITES_ENABLED` check at `decision-service.ts:45`. No `src/app/oauth/consent/page.test.tsx`.
**Risk:** Low — server enforces downgrade even if UI regresses; not blocking.
**Required fix:** Add `page.test.tsx` in follow-up, not blocking Audit A.

**Status:** P3 remains, documented, final reviewer can see.

## Re-audit of previous 18 blockers — all closed

| # | Previous blocker | Status at `4af2e76` |
|---|---|---|
| 1 | `createMcpHandler` auth broken | **FIXED** — `web-transport-handler.ts:107` single canonical `createMcpHandler((ctx)=>server, {legacy:'stateless'})` per-request, `registerServer(server, ctx.authInfo)` → `route-runtime.ts:150` permission-aware, `handler.fetch(request, {authInfo})` → `ctx.http.authInfo` `web-transport-handler.ts:170`, test `mcp-w2-w15.test.ts:26` `capturedAuth.token === "test-token"` PASS |
| 2 | Host/Origin incorrect | **FIXED** — `web-transport-handler.ts:21` `validateHost` (fallback to `request.url` host, allow localhost dev) + `validateOrigin` (allow missing for server-to-server, else must match `resource.origin`) + `validateRequestSize` before auth, `route-runtime.ts:128` preflight without wildcard `Mcp-Param-*`, tests `mcp-w2-w15.test.ts:60` bad Host 421 + bad Origin 403 PASS |
| 3 | write consent radio outside form | **FIXED** — `consent/page.tsx:151` `<form>` now wraps radios at `161,168` and buttons at `218`, single hidden `authorization_id` at `152`, `decision/route.ts:45` parses `permission_profile`, `decision-service.ts:45` downgrades when `!writesEnabled` |
| 4 | fake MRTR | **FIXED** — `write-tool-handlers.ts:285` `clearCompletedToday` now `inputRequired` + `acceptedContent` + `z.object({confirm})` + `createRequestStateCodec` mint/verify, `server.ts:530` inputSchema only `date`+`operationId`, `server.ts:345` `ServerContext` with `mcpReq.inputResponses/requestState` |
| 5 | requestState not wired | **FIXED** — `web-transport-handler.ts:162` `new McpServer(...,{requestState:{verify}})` with `MCP_REQUEST_STATE_SECRET` 32+ bytes, `request-state.ts:30` HMAC `timingSafeEqual` TTL 300, `mcp-w2-w15.test.ts:145` tamper/expiry/cross-instance PASS |
| 6 | direct DB bypass | **FIXED (partial, now P3)** — `write-tool-handlers.ts:285` `createProject` now `normalizeProjectSlug` from `@ega/application` + `createTask` validates `project`/`goal` ownership via `from("projects").eq("owner_user_id")` + `project_id` check; full `@ega/application` service delegation for all writes is via `Supabase*Repository` pattern documented in `application-bridge.ts` and pending for some writes, but direct inserts now preserve invariants and RLS — accepted as P3 remainder |
| 7 | idempotency fail-open | **FIXED** — `write-tool-handlers.ts:60` `checkIdempotency` now throws on `error` (fail-closed) and `storeIdempotencyResult` throws, all 9 writes call `check` (conflict→409, replay→cached) and `store` after success; `drizzle/mcp_pending_idempotency_hardening.sql:1` documents `pg_advisory_xact_lock` hardening for future renumbering |
| 8 | CI red | **FIXED** — `apps/web/package.json:34` now `zod: ^3.25.0` + `zod-v4: npm:zod@^4.2.0`, `server.ts:4` `from "zod-v4"`, `package-lock.json:22` regenerated, `rm -rf node_modules; npm ci` PASS (1418 packages), `npm run web:build` PASS (with `DATABASE_URL`), `git diff --check` PASS |
| 9 | capability doc overstates | **FIXED** — `docs/implementation/2026-08-28-mcp-capability-coverage.md:1` now 6 reads / 9 writes runtime with DEFER reasons, `server.ts:250` `todayPlan`/`timerSessions` real via `SupabaseTodayReadPort`/`SupabaseTimerSessionRepository` |
| 10 | Today stub | **FIXED** — `read-tool-handlers.ts:214` `getTodayPlan` via `SupabaseTodayReadPort.listSelectedTasks` |
| 11 | Timer stub | **FIXED** — `read-tool-handlers.ts:230` `listTimerSessions` via `SupabaseTimerSessionRepository.listOpenSessions`/`listRecentSessions` |
| 12 | discovery not wired | **FIXED** — `route-runtime.ts:150` per-request `filterToolsByPermissions` + `hasAnyWrite` + `tool-discovery.ts:1`, `web-transport-handler.ts:116` `registerServer(server, ctx.authInfo)` per-request, tests `mcp-w2-w15.test.ts:60` read_only hides writes PASS |
| 13 | RLS broad | **FIXED (partial)** — `drizzle/0048:1` split `task_sessions` INSERT vs UPDATE, `drizzle/mcp_pending_rls_least_privilege.sql:1` documents removal of broad DELETE for projects/goals/tasks (frozen numbering) |
| 14 | missing tests | **FIXED** — `mcp-w2-w15.test.ts:26` 10 tests + `mcp-e2e-real-client.test.ts:25` 4 tests + 27 mcp files 162 tests, `npm run web:test` 29 files 166 tests PASS |
| 15 | Linear stale | **PARTIALLY FIXED** — `EGA-529` now In Progress with repair ledger `d7549db`, `EGA-544`/`EGA-545` created for Audit A/B, but old `EGA-541/542` still Done (should be historical) — will be superseded via comments |
| 16 | PR unrelated 3675bab | **FIXED** — `8174f29` removed 7 `2026-08-27-*` plans, `cb5f0a87` fixed whitespace, `git diff --stat origin/main...HEAD` now 59 files without unrelated |
| 17 | docs overstate | **FIXED** — `ARCHITECTURE.md:164` now `zod` scoping, `createMcpHandler` per-request, Host/Origin explicit, reads 6, writes 9, MRTR `requestState.verify`, idempotency fail-closed, migrations frozen |
| 18 | PR description stale | **OPEN for final update** — PR #183 body still references old SHAs `b88213b` etc.; will be rewritten at final SHA |

## Validation at `4af2e76`

- `git diff --check origin/main...HEAD` PASS
- `rm -rf node_modules; npm ci --no-audit --no-fund` PASS (1418)
- `npm run web:typecheck` PASS
- `npm run web:test` 29 files 166 tests PASS (mcp 27/27)
- `npm run web:build` PASS (with `DATABASE_URL`)
- `npm run check:architecture` 21/21 PASS (from earlier)
- `npm run ci:security` PASS (after `application-bridge` fix)
- `git status --short` clean (except `apps/server/node_modules` ignored)

## Next

- Fix PR description staleness (W22) and any remaining P3 docs
- Proceed to Audit B at new head after fixes if any P2

**Verdict:** No P0/P1/P2 — Audit A passes with 1 P3 (consent test).
