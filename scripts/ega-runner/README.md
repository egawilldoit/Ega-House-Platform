# EGA Runner

Durable worker for the EGA House governed implementation loop.

```text
Linear authorization
→ signed webhook / durable run
→ PGMQ message
→ Runner claim + lease
→ isolated worktree
→ Hermes implementation
→ Runner-owned scope, commit, and command validation
→ verified branch push
→ verified GitHub PR
→ PR/check/review/preview monitor
→ bounded Hermes repair loop
→ READY_TO_MERGE
→ human merge by default
```

The Runner is the orchestration and evidence authority. Hermes edits code inside the authorized worktree; Hermes does not decide whether delivery succeeded.

## Durable graph

```text
queued
→ preparing
→ running
→ pr_open
→ repairing ↺
→ awaiting_review
→ ready_to_merge
→ merged
```

Failure/stop states:

```text
validation_failed
pr_failed
needs_human
failed
cancelled
stale
```

A run is never marked successful merely because Hermes exits with code `0`. A verified PR is required before `pr_open` is persisted. PR creation or identity verification failure produces `pr_failed` and the queue message is archived only after that durable failure is recorded.

## Implementation path

The queue-driven path performs:

1. Atomic run claim and coordinated database/PGMQ leases.
2. Real Linear issue and parent-Spec resolution.
3. Exact authorized-path extraction.
4. Deterministic context hash, branch, and worktree.
5. Bounded Hermes execution with YOLO disabled.
6. Structured result validation.
7. Independent scope and Git commit verification.
8. Runner-owned validation commands.
9. Branch push and remote SHA verification.
10. Idempotent PR create-or-reuse and exact head/base verification.
11. Durable `pr_open` transition and queue archival.

## PR monitor and repair

The same Runner process polls due runs in `pr_open`, `awaiting_review`, and `ready_to_merge`.

It observes:

- exact PR branch and head SHA;
- GitHub check runs and commit statuses;
- bounded failed-workflow log excerpts;
- review decision and unresolved review threads;
- exact-SHA Vercel preview when required.

A failed check or new actionable review finding starts one bounded repair attempt. Hermes receives only the failed evidence, unresolved review context, authorized paths, and validation commands. The Runner then verifies the new commit, scope, validation, push, and remote SHA.

Failed repair attempts preserve evidence and reset the isolated worktree to the observed PR head before retrying. The default limit is three attempts. Exhaustion, history rewrite, external branch mutation, review pagination beyond the bounded inspection limit, or merge conflict produces `needs_human`.

Old unresolved comments that already triggered a repair are not repeatedly sent to Hermes. They remain a merge blocker until a reviewer resolves or supersedes them.

## Start

```bash
cd scripts/ega-runner
npm start
```

Smoke mode:

```bash
npm run smoke
```

Focused validation:

```bash
npm run typecheck
npm run test:pr-loop
```

From the repository root:

```bash
npm run typecheck:ega-runner
npm run test:ega-runner-pr-loop
```

## Required configuration

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | required | Postgres/PGMQ connection |
| `LINEAR_API_KEY` | required in production | Resolve the authorized issue contract |
| `EGA_RUNNER_REPO_ROOT` | repository root | Authoritative local clone |
| `EGA_RUNNER_QUEUE_NAME` | `hermes_implementation_jobs` | PGMQ queue |
| `EGA_RUNNER_VISIBILITY_TIMEOUT_SECONDS` | `300` | Initial queue visibility timeout |
| `EGA_RUNNER_HEARTBEAT_SECONDS` | `60` | DB and queue heartbeat |
| `EGA_RUNNER_LEASE_SECONDS` | `300` | Run ownership lease |
| `EGA_RUNNER_MAX_TURNS` | `50` | Initial Hermes turn limit |
| `EGA_RUNNER_REPAIR_MAX_TURNS` | `25` | Repair turn limit |
| `EGA_RUNNER_MAX_REPAIR_ATTEMPTS` | `3` | Bounded repair attempts |
| `EGA_RUNNER_PR_MONITOR_INTERVAL_SECONDS` | `60` | PR polling interval |
| `EGA_RUNNER_PR_MONITOR_BATCH_SIZE` | `5` | Due PRs per loop |
| `EGA_RUNNER_REQUIRE_VERCEL_PREVIEW` | `false` | Require exact-SHA READY preview |
| `EGA_RUNNER_AUTO_MERGE` | `false` | Request GitHub auto-merge only after readiness, pinned to the observed head SHA |
| `EGA_RUNNER_SLACK_CHANNEL` | `#hermes-today` | Notification channel |

The checked-in web and API `vercel.json` files declare Git deployments disabled
for `"*"` and enabled only for `main`. Repository declarations do not prove the
connected Vercel projects or Git integration enforce that policy: independent
external evidence records API deployment `6233638086` for feature-branch HEAD
`21d9febba61c20ec45f7ff68f644b684f23335c3`. Wave 00 remains blocked pending
authenticated verification and correction of those external settings.

With the default `EGA_RUNNER_REQUIRE_VERCEL_PREVIEW=false`, a missing preview is
not a readiness failure: an approved, mergeable PR with complete passing checks
can become `ready_to_merge`. Setting the variable to `true` is an explicit
opt-in that requires an exact-SHA `READY` preview. When credentials are
available, the Vercel verifier may also record an exact-SHA production
deployment; that observation is separate from preview readiness and is not
deployment authority.

The VM also requires Git, authenticated `gh`, Hermes, Node.js 20+, and the database migration `0036_runner_pr_watch_repair_graph`.

## Safety invariants

- Never execute destructive `pgmq.pop()`; use `read → set_vt → archive`.
- Never work directly on `main`.
- Never trust Hermes prose, exit status, validation claims, branch, or commit without independent proof.
- Never mark a queue run complete without a verified PR.
- Never treat Slack as workflow truth.
- Never auto-merge by default; when explicitly enabled, require the reviewed head SHA with `--match-head-commit`.
- External mutation of the owned PR branch fails closed to `needs_human`.
- GitHub checks and statuses are paginated and tracked by stable record identity before readiness is computed.
- Monitor and repair transitions use compare-and-swap predicates on state and PR head.
- Attempt branch/path collisions are rejected; stale work is never force-reset.
- A repair may modify only the original authorized paths.

## Current limitations

- The monitor is polling-based rather than GitHub-webhook-driven.
- Human approval and repository branch protection remain external GitHub controls.
- The persisted worktree must remain available for automated repair.
- Stale-attempt creation and cross-system reconciliation are not yet implemented.
- Live Linear, PGMQ, Hermes, GitHub, Vercel, and Slack execution must still be proven on the VM.
