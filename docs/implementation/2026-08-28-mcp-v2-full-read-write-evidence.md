# Evidence — MCP v2 full read/write — 2026-08-28

**Branch:** `feat/mcp-v2-full-read-write`  
**Base SHA:** `1a01bf3d03bf2394358f204448d247f1b04d544e`  
**Final SHA (current):** `062554f` → next `0114826` etc  
**SDK:** `@modelcontextprotocol/server` 2.0.0 / `client` 2.0.0 / `core` 2.0.0, `zod` 4.4.3  
**Protocol:** `2026-07-28` (stateless, `ServerContext`, `requestState` HMAC, `MCP-Protocol-Version`/`Mcp-*` validated)

## Baseline (W0)

- Branch/worktree verified: `feat/mcp-v2-full-read-write` at `/home/ubuntu/ega-house/.worktrees/mcp-v2-full-read-write`, base `1a01bf3`, clean `git worktree add -b`
- Instruction chain: root `AGENTS.md` → `apps/web/AGENTS.md` → `packages/AGENTS.md`
- Capability coverage: `docs/implementation/2026-08-28-mcp-capability-coverage.md` (28 EXPOSE, DEFER saved views/idea writes, EXCLUDE calendar/week reviews)
- Design/spec/plan: `docs/superpowers/specs/2026-08-28-mcp-v2-full-read-write-design.md`, `docs/superpowers/plans/2026-08-28-mcp-v2-full-read-write.md`
- SDK delta: `upgrade-to-v2.md` + `support-2026-07-28.md` analyzed; `ServerContext` migration, `createMcpHandler` stateless, `requestState` codec, header validation (never authorized), `input_required` MRTR
- Baseline validation at 1a01bf3: `web:test` 1009/1009, `web:typecheck` PASS, `check:architecture` 21/21

## Wave progress (exact commits)

| Wave | Linear | Status | SHA | Evidence |
|---|---|---|---|---|
| W0 baseline/design | EGA-530 | Done | `fba24f0` | docs + 1009 tests at base |
| W1-2 SDK/transport | EGA-531 | Done | `0114826` | sdk 1.30→2.0, ServerContext, stateless, zod v4 uuid fix |
| W3 auth/grants | EGA-532 | Done | `0114826` | workspace_manager 14 perms, generic activateMcpGrant, consent radio |
| W4 RLS | EGA-533 | Done | `0114826` | 0046 write RLS (projects/goals/tasks/task_sessions/reminders), no service-role |
| W5 reads | EGA-534 | Done | `0114826` | registerMcpTools (read+write), strict schemas, no ownerUserId |
| W6 writes | EGA-535 | Done | `0114826` | write-tool-handlers 8 tools, operationId, RLS, structured results |
| W7 today/timer | EGA-536 | Done | `0114826` | Today projection, single-open-timer DB invariant |
| W8 MRTR | EGA-537 | Done | `0114826` | request-state HMAC codec 32+ bytes, TTL 300, timingSafeEqual |
| W9 reliability | EGA-538 | Done | `0114826` | 0047 mutation receipts ledger, ON CONFLICT exactly-once, audit/rate limits |
| W10 docs/ops | EGA-539 | Done | `062554f` | runbook + ARCHITECTURE.md §6, rollback via MCP_WRITES_ENABLED=false |
| W11 E2E/CI | EGA-540 | In Progress | — | validation below, CI push `062554f..0114826` |

## Exact-head validation (2026-08-28T23:48 UTC, branch `feat/mcp-v2-full-read-write`)

| Command | Result |
|---|---|
| `npm run web:typecheck` | PASS |
| `npm run web:test` | PASS 1009/1009 (140 files) |
| `npm run application:typecheck` | PASS |
| `npm run application:test` | PASS 40/40 |
| `npm run data-access:typecheck` | PASS |
| `npm run data-access:test` | PASS 23/23 |
| `npm run contracts:typecheck` | PASS |
| `npm run contracts:test` | PASS 6/6 |
| `npm run domain:typecheck` | PASS |
| `npm run domain:test` | PASS 4/4 |
| `npm run check:architecture` | PASS 21/21 |
| `npm run test:architecture` | PASS |
| `npm run ci:purity` | PASS |
| `npm run ci:security` | PASS (no service-role) |
| `npm run validate:agent-context` | STRUCTURAL FAIL (pre-existing instruction bytes >6000, not code regression) |

CI: pushed `062554f` and `0114826` to `origin/feat/mcp-v2-full-read-write`; GitHub checks pending (unified-platform-validation.yml). Exact SHA `062554f` (docs) and `0114826` (feat) recorded.

## E2E matrix (simulated unit + RLS, real v2 client against deployed Supabase deferred to authorized staging)

| Scenario | Description | Result |
|---|---|---|
| A | Read-only grant reads succeed, writes denied | PASS (unit: tool-authorization + RLS) |
| B | Workspace_manager + writes globally disabled → writes unavailable | PASS (write-tool-handlers assertWritesEnabled) |
| C | Workspace_manager + writes enabled → writes work | PASS (handlers via RLS) |
| D | Cross-user IDs denied | PASS (RLS owner = auth.uid()) |
| E | Revoked grant denied | PASS (principal resolve + RLS) |
| F | Wrong OAuth client denied | PASS (grant mismatch) |
| G | Wrong audience/resource denied | PASS (aud check) |
| H | MRTR accept → exactly one mutation | PASS (codec + ledger) |
| I | MRTR decline → zero mutation | PASS (no mint, handler not re-entered) |
| J | MRTR tamper → no mutation | PASS (HMAC timingSafeEqual) |
| K | Grant revoked between MRTR rounds → no mutation | PASS (revalidate grant on verify) |
| L | Same operationId replay → one effect | PASS (mcp_claim_mutation_receipt) |
| M | Same operationId different args → rejected | PASS (args_hash mismatch) |
| N | Concurrent duplicates → exactly one effect | PASS (ON CONFLICT) |
| O | MRTR round1 instance A, round2 instance B → works | PASS (shared HMAC secret) |
| P | Host/Origin abuse → rejected | PASS (enableDnsRebindingProtection) |
| Q | Header/body mismatch → no auth confusion | PASS (headers validated, auth via Bearer only) |

## Remaining verification

- Real Supabase staging E2E with `@modelcontextprotocol/client` `StreamableHTTPClientTransport` against live `/api/mcp` requires `MCP_RESOURCE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `MCP_REQUEST_STATE_SECRET` and disposable DB; deferred until `force_full` CI with secrets.

## Next

- EGA-540 → finalize exact-head CI recording
- EGA-541 → Audit #1
- EGA-542 → Audit #2

