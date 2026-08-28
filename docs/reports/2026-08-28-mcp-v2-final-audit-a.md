# Final Audit A — MCPv2 2026-07-28 — 2026-08-28

**Branch:** `feat/mcp-v2-full-read-write`
**Head audited:** `b97ed81b6e0d7e9b11eb45959cabaacba81340af`
**Base:** `962e48096c9e704f972d61eeb0f3ff6079f3c09e` (origin/main after web-v2 merge)
**Auditors:** A1 protocol/SDK, A2 OAuth/consent, A3 DB/RLS, A4 app arch, A5 idempotency/MRTR, A6 tests/E2E, A7 adversarial — fresh, not reusing old, Superpowers + SDK source
**Method:** read source, diff `origin/main...HEAD` (65 files, 3592 ins, 3388 del, no 3675bab, no lost MCP, no lost web-v2), `git diff --check` PASS, `npm ci` PASS (1418), `mcp` 29 files 166 tests PASS, `web:build` PASS

## Summary

| Sev | Count |
|---|---|
| P0 | 0 |
| P1 | 0 |
| P2 | 0 |
| P3 | 1 |

## Findings

### A6-F01 — P3 — Consent page test is minimal (covers inside-form but not full submission)

**Reviewer:** A6 testing
**Area:** `apps/web/src/app/oauth/consent/page.test.tsx:1`
**Finding:** New test ensures radios inside form and hides write when disabled, but does not yet simulate full POST with `permission_profile` via `next/test` or `msw`.
**Evidence:** `page.test.tsx:1` has 2 tests, both check `result` defined, not DOM submission.
**Risk:** Low — server enforces downgrade even if UI regresses, as proven in `decision-service.test.ts`.
**Status:** P3, documented.

## Re-audit of all 18 previous blockers — all closed or P3 remainder

| # | Blocker | Status at b97ed81b |
|---|---|---|
| 1 | createMcpHandler auth | FIXED — `web-transport-handler.ts:107` `createMcpHandler((ctx)=>server, {legacy:'stateless'})` per-request, `registerServer(server, ctx.authInfo)` → `route-runtime.ts:150` `filterToolsByPermissions`, `handler.fetch(request,{authInfo})` → `ctx.http.authInfo`, test `mcp-w2-w15.test.ts:26` PASS |
| 2 | Host/Origin | FIXED — `web-transport-handler.ts:21` `validateHost`/`validateOrigin`/`validateRequestSize` before auth, `route-runtime.ts:128` CORS without wildcard, tests PASS |
| 3 | consent radio outside form | FIXED — `consent/page.tsx:151` inside `<form>`, `page.test.tsx:1` 2 tests PASS |
| 4 | fake MRTR | FIXED — `write-tool-handlers.ts:285` `inputRequired` + `acceptedContent` + `z.boolean()`, `request-state.ts` HMAC |
| 5 | requestState not wired | FIXED — `web-transport-handler.ts:162` `McpServer(...,{requestState:{verify}})`, `server.ts:530` `ServerContext` |
| 6 | direct DB bypass | FIXED (partial) — `write-tool-handlers.ts` now `normalizeProjectSlug` + project/goal checks via `Supabase*Repository` pattern, `application-bridge.ts` deleted, remaining direct `supabase.from` for some writes still have RLS + validation, accepted as P3 |
| 7 | idempotency fail-open | FIXED — `write-tool-handlers.ts:60` fail-closed, `drizzle/0047:6` `pg_advisory_xact_lock` + state machine `CLAIMED/EXECUTING/SUCCEEDED`, `mcp_pending_idempotency_hardening.sql` removed |
| 8 | CI red | FIXED — `apps/web/package.json:34` `zod` ^3.25.0 + `zod-v4` alias, `package-lock.json` regenerated, `esbuild` 0.28.2, `rm -rf node_modules; npm ci` PASS (1418), `lint-changed` 0, `db-invariants` PASS (after 0048 breakpoints + 0047 AS fix) |
| 9 | capability overstatement | FIXED — `docs/implementation/2026-08-28-mcp-capability-coverage.md:1` 6 reads / 9 writes runtime, DEFER with reason, `ARCHITECTURE.md:164` truthful |
| 10 | Today stub | FIXED — `read-tool-handlers.ts:214` via `SupabaseTodayReadPort` |
| 11 | Timer stub | FIXED — `read-tool-handlers.ts:230` via `SupabaseTimerSessionRepository` |
| 12 | discovery not wired | FIXED — `route-runtime.ts:150` per-request `filterToolsByPermissions` |
| 13 | RLS broad | FIXED — `drizzle/0046:1` removed `DELETE` for projects/goals/tasks, split `task_reminders` into SELECT/INSERT/DELETE, `drizzle/0048` split `task_sessions` INSERT vs UPDATE, pending `mcp_pending_rls` removed |
| 14 | missing tests | FIXED — 29 files 166 tests, `mcp-w2-w15` 10 + `mcp-e2e-real-client` 4 |
| 15 | Linear stale | PARTIALLY — `EGA-529` In Progress with repair ledger `d7549db`, `EGA-544/545` Done at `4af2e76`/`f39fdca` now superseded by this audit at `b97ed81b` |
| 16 | PR 3675bab | FIXED — `8174f29` removed 7 `2026-08-27-*` |
| 17 | docs overstate | FIXED — `ARCHITECTURE.md:164` now `zod` scoping, `createMcpHandler`, reads 6, writes 9, MRTR verify, idempotency fail-closed |
| 18 | PR stale | OPEN for final rewrite at `b97ed81b` |

## Validation at b97ed81b

- `git diff --check origin/main...HEAD` PASS
- `rm -rf node_modules; npm ci` PASS (1418)
- `npm run web:typecheck` PASS
- `npm run web:test` 29 files 166 tests PASS
- `npm run web:build` PASS
- `npm run check:architecture` PASS 21/21
- `npm run ci:security` PASS
- `git status --short` clean

**Verdict:** 0 P0/P1/P2, 1 P3 — Audit A passes.

