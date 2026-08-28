# Repair Audit B — MCPv2 2026-07-28 — 2026-08-28

**Branch:** `feat/mcp-v2-full-read-write`
**Head audited:** `94862a76f503482076fae6d8e487e097b6f82fcc` (Audit A)
**Base:** `1a01bf3d03bf2394358f204448d247f1b04d544e`
**Auditors:** B1 protocol/SDK, B2 OAuth/consent, B3 DB/RLS, B4 app arch, B5 MRTR/idempotency, B6 tests/E2E, B7 adversarial — different reviewers from Audit A, fresh, independent, Superpowers + SDK source
**Method:** same 7 dimensions, read source, diff `origin/main...HEAD` (now 59 files + 0045-0048 + pending, no 3675bab), `git diff --check` PASS, `npm ci` PASS, `mcp-w2-w15` + `mcp-e2e-real-client` tests, `write-tool-handlers` + `web-transport-handler` + `route-runtime` + `consent/page` code truth

## Summary

| Sev | Count |
|---|---|
| P0 | 0 |
| P1 | 0 |
| P2 | 0 |
| P3 | 1 |

**Blocking:** 0 — Audit B passes, ready for exact-head validation and CI.

## Findings

### B6-F01 — P3 — Consent page test still missing (same as Audit A A6-F01/B6-F01)

**Reviewer:** B6 testing
**Area:** `apps/web/src/app/oauth/consent/page.tsx:151`
**Finding:** Form now correctly wraps radios (W4 fixed) and server enforces `MCP_WRITES_ENABLED` downgrade, but no dedicated unit test for the page's DOM association.
**Evidence:** No `src/app/oauth/consent/page.test.tsx`, but manual verification and `decision-service` test cover server path.
**Risk:** Low — not blocking, explicitly documented.
**Status:** P3 remains.

## Re-audit of Audit A — all 7 dimensions re-checked at `94862a7`

- **A1/B1 protocol:** `web-transport-handler.ts:107` `createMcpHandler` per-request with `ctx.authInfo` → `ctx.http.authInfo` PASS, `mcp-w2-w15.test.ts:26` auth propagation PASS, `server/discover` via `createMcpHandler` (private, no `Mcp-Session-Id`), `validateHost`/`validateOrigin` explicit before auth, `Mcp-Method`/`Mcp-Name` not auth.
- **A2/B2 OAuth:** `consent/page.tsx:151` inside form, `decision/route.ts:45` parses, `decision-service.ts:45` downgrades, no silent upgrade, manipulated POST rejected, `MCP_WRITES_ENABLED` kill switch proven.
- **A3/B3 DB:** `drizzle/0045-0048` frozen per isolation, `0048` split, `mcp_pending_*.sql` pending hardening docs, `write-tool-handlers` uses `owner_user_id = principal.ownerUserId` + RLS, no caller-selected owner, `ci:security` PASS.
- **A4/B4 app:** `write-tool-handlers.ts:285` `createProject` via `normalizeProjectSlug`, `createTask` validates project/goal ownership, `read-tool-handlers.ts:214` Today via `SupabaseTodayReadPort.listSelectedTasks`, Timer via `SupabaseTimerSessionRepository`, `server.ts:250` 6 reads / 9 writes, capability doc 6/9 with DEFER reasons.
- **A5/B5 MRTR/idempotency:** `request-state.ts:30` HMAC `timingSafeEqual` TTL 300, `web-transport-handler.ts:162` `requestState.verify` via `MCP_REQUEST_STATE_SECRET`, `write-tool-handlers.ts:285` `clearCompletedToday` `inputRequired` + `acceptedContent` with `confirmationSchema` `z.boolean()`, `checkIdempotency` fail-closed (throw on ledger error), all 9 writes call check/store, `mcp-w2-w15.test.ts:145` tamper/expiry/cross-instance PASS, `mcp_pending_idempotency_hardening.sql` pending advisory lock.
- **A6/B6 tests:** 29 files 166 tests PASS (`web:test` 14:32), `mcp-w2-w15` 10 tests + `mcp-e2e-real-client` 4 tests, plus 27 mcp files, `route-runtime` preflight without wildcard `Mcp-Param-*`, `web:build` PASS.
- **A7/B7 adversarial:** No `ownerUserId` from args, no `Mcp-Method` as auth, no service-role bypass, `git diff --check` PASS, `npm ci` PASS, `ARCHITECTURE.md:164` now truthful (`zod` scoping, `createMcpHandler`, Host/Origin explicit, reads 6, writes 9, MRTR `requestState.verify`, idempotency fail-closed, migrations frozen).

## Validation at `94862a7`

- `git diff --check origin/main...HEAD` PASS
- `rm -rf node_modules; npm ci --no-audit --no-fund` PASS (1418)
- `npm run web:typecheck` PASS
- `npm run web:test` 29/166 PASS
- `npm run web:build` PASS
- `npm run check:architecture` 21/21 PASS (prev)
- `npm run ci:security` PASS
- `git status --short` clean

## Next

Exact-head validation at `94862a7` (or final after docs), CI green, PR update, final Linear.

**Verdict:** P0 0, P1 0, P2 0, P3 1 (consent test) — Audit B passes.

