# Wave 11 — Performance and Responsiveness

Status: REBUILT ON `2f2923aa` — PENDING CI + REVIEW

## Boundary

- Branch: `wave/11-performance`
- Rebuilt base: `2f2923aab0da9bb78ffbe86a84490df4756143e9` (Wave 10 merge, PR #220)
- Historical wave-11 tip (superseded, local backup `backup/wave11-pre-reconcile-1e35387b`):
  `1e35387b577eaa352d41706666ff9b55418bc88d`, whose wave-local parent was `71031532`.
- Previous wave: Wave 10 cross-platform consistency
- Scope: measured web and mobile responsiveness work only; no semantic or product expansion.
  True wave-11 delta on the rebuilt base: one bounded read + one regression test + this ledger.
  No prior-wave history is carried.

## Measurement record

The first local web build measurement was attempted at the Wave 10 dependency state. The
Wave 11 worktree reuses that complete dependency tree because a second `npm ci` exhausted
available workspace disk while creating incomplete generated `node_modules` output.

The measured build reached compilation and TypeScript, then stopped during page-data
collection because this environment has no `DATABASE_URL`:

```text
Next 16.2.12 Turbopack
compile: 45s
TypeScript: 28.3s
elapsed_seconds: 80.21
max_rss_kb: 2131192
failure: Missing env.DATABASE_URL for /api/agent/capabilities
```

This is build/runtime-environment evidence, not a production performance baseline. The
exact Wave 10 CI build passed; protected authenticated routes and a database-backed local
runtime are unavailable in this environment.

## Static audit targets

- server/data-access reads with no explicit bound;
- duplicate query calls within one request;
- mobile query/refetch churn and list sizing;
- large client boundaries and unbounded presentation lists.

Re-audit on the rebuilt base confirmed the same single unbounded `task_sessions` read in
`SupabaseTimerSessionRepository.listOpenSessions`. The database has the canonical
`task_sessions_owner_open_unique` partial unique index, and all callers need the active
session set only.

### Performance patch record

- Observed problem: the owner-scoped open-session query filtered and ordered rows but did not bound the result.
- Before evidence (TDD RED): the new repository regression failed on the rebuilt base
  because the recorded query steps ended after `order:started_at`.
- Root cause: the read path retained an unbounded result shape after the database/application contract established at most one open session per owner.
- Change: `listOpenSessions` now applies `.limit(1)` after the descending start-time order.
- After evidence (TDD GREEN): the same regression passes and records `limit:1`; the full
  owner-scoped timer repository suite (106 tests) remains green with typecheck clean.
- Semantic check: this preserves the newest active session contract and does not change writes, actor derivation, RLS, or timer state transitions.

## Acceptance gates

- Code: targeted regression, affected package checks, architecture/security/purity, and exact-head CI.
- Runtime: before/after evidence where the environment permits; unavailable authenticated/database evidence remains explicit.
- Product: no freshness, timer, or cross-platform semantic change; responsiveness work must reduce avoidable work.
- Review: independent range review with Critical = 0, Important = 0.
- Publication: clean diff, exact head recorded, PR updated, no production deployment.

## Known baseline debt

- local agent-context byte-budget findings predate this wave;
- dependency installation cannot be repeated in this worktree without risking disk exhaustion;
- no new baseline failure is attributed to Wave 11.

## Final acceptance record

- Prior-attempt evidence (historical head `1e35387b`, NOT this rebuilt head): exact CI run
  `33814749056` passed all required jobs; a later docs-only run `33815100777` stalled at the
  workspace dependency-audit step and was quarantined as CI-service evidence unavailable.
  These runs do not certify the rebuilt head; a fresh exact-head CI run is required.
- Runtime gate: ACCEPTED — EXTERNAL EVIDENCE NOT AVAILABLE. Authenticated/database-backed
  performance and Android emulator/device performance could not be exercised here.
- Product gate: PASS — no product surface or canonical timer semantics changed.
- Review/CI gates for the rebuilt head: recorded below after push.
