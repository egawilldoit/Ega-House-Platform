# Intelligence Foundations Plan — 2026-08-27

Branch: feat/intelligence-foundations
Worktree: .worktrees/intelligence-foundations
Base: 1a01bf3d03bf2394358f204448d247f1b04d544e

## Scope
F0 EGA-525 Work Analytics head:true bug
F1 EGA-523 Shared Time Context (HITL — timezone policy needs human approval, implement smallest valid owner-scoped persistence)
F2 EGA-524 Shared Execution Evidence

Sequential in one worktree (one writer). F0 independent, F1 blocks F2.

## F0 EGA-525
Issue: https://linear.app/egawilldoit/issue/EGA-525
Current: apps/web/src/lib/services/work-analytics-data-adapter.ts uses head:true but reads data?.length; tests mock data arrays masking bug.
Tasks:
- T1: Fix getWorkAnalyticsTaskCounts to use count field: destructure {count, error} and return count. Handle null count fallback. Keep error paths. File: work-analytics-data-adapter.ts
- T2: Update test mock to return {count, data:null} and prove real head semantics; add regression test that data.length not used. File: work-analytics-data-adapter.test.ts
- T3: Verify other head:true usages (workspace-shell.ts, review export) not affected or fix if same bug.
Validation: npm run web:test work-analytics-data-adapter.test.ts, npm run web:typecheck
Commit: fix: correct Work Analytics head:true count semantics (EGA-525)
Blocking: blocks EGA-510

## F1 EGA-523
Issue: https://linear.app/egawilldoit/issue/EGA-523
Current evidence: packages/application/src/shared/duration.ts uses runtime process timezone; apps/web/src/lib/review-week.ts UTC; apps/web today builders duplicate logic.
Contract:
- IANA timezone, local date, UTC start/end, week Monday, DST 23/25h, invalid fallback, historical window reproducibility, no process TZ authority.
Implementation:
- Domain: packages/domain/src/time-context.ts — pure functions: getLocalDayWindow(timezone, dateStr), getWeekWindow(timezone, dateStr), isValidIANAZone
- Application: packages/application/src/shared/time-context-service.ts — resolveTimeContext(userId, requestedZone, now) + persistence port `TimeContextRepository` (get/set user timezone)
- Data-access: packages/data-access/src/repositories/time-context-repository.ts — owner-scoped read of profiles/timezone? If no profile table, add user_time_context table via migration; else use profiles row. Check schema first.
- Contracts: packages/contracts/src/time-context.ts DTO
- Migration: src/db/schema.ts + drizzle/0045_time_context — holds user_id PK, iana_timezone, created_at/updated_at. Need lock.
- Web/mobile use: export from application, web server composes directly, mobile via Hono.
AC mapped:
- AC1 shared helper owns semantics -> domain + application files
- AC2 web/mobile same day -> Hono route returns same window for same tz
- AC3 server process TZ not affect -> pure functions test with TZ env override
- AC4 DST 23/25h -> test with America/New_York 2026-03-08 and 2026-11-01
- AC5 invalid/missing fallback -> fallback to UTC with flag
- AC6 historical reproducibility -> week window explicit input, not now
- AC7 tests midnight/DST adjacency
Validation: domain:test, application:test, data-access:test, contracts:typecheck, check:architecture
Commit: feat: add canonical Shared Time Context (EGA-523)

## F2 EGA-524
Issue: https://linear.app/egawilldoit/issue/EGA-524
Current: task_sessions canonical, web-local execution-evidence-service.ts useful but not shared, duration helpers in application.
Tasks:
- Promote execution-evidence-service to packages/application/src/shared/execution-evidence.ts with types: ExecutionEvidenceWindow, SessionRow, EvidenceQuality, AggregationResult, ordered transitions
- Data-access: execution-evidence-repository.ts owner-scoped retrieval
- Overlap semantics: session overlap inside window, open-session policy (documented: includeOnlyClosed by default, provisional if open), tracked seconds by Task/Project/Goal/day, deterministic ordering for equal timestamps (secondary sort by task_id), quality flags
- Tests: open sessions, malformed ranges, overlap boundaries, zero data, cross-midnight, owner isolation, no double-count
- Preserve Work Analytics behavior via adapter
Validation: application:test, data-access:test
Commit: feat: add canonical Shared Execution Evidence (EGA-524)

## Ledger
- F0 start -> implement -> test -> review -> commit
- F1 start -> design -> migration lock -> implement -> test -> review
- F2 start -> extract -> test -> review
