# Friction Radar Plan — 2026-08-27

Branch: feat/friction-radar
Worktree: .worktrees/friction-radar
Base: 1a01bf3d03bf2394358f204448d247f1b04d544e

## Parent EGA-495 — feeds Operator, Health, Weekly Review
Consumes F1/F2 time context + execution evidence.

## R1 EGA-496 Stale/blocked signals — independent
Tasks:
- Application: packages/application/src/friction/stale-blocked-signals.ts — blocked Tasks (blocked_reason/status), stale threshold (e.g., 7d inactive), owner-scoped
- Data-access: friction-repository.ts
- Contracts: friction.ts
- Server/Api-client/Mobile/Web shared read model
- Tests: active blocked includes age, stale threshold, archived excluded, empty state
Commit: feat: add stale/blocked friction signals (EGA-496)

## R2 EGA-497 Estimate accuracy + context switch — requires F1/F2
Blocked until intelligence-foundations lands F1/F2. Consume shared execution evidence.
Tasks: application/src/friction/estimate-accuracy.ts + context-switch.ts using F2 evidence
AC: estimate evaluated only with tracked evidence, no double-count overlap, switch = task id transition, thresholds deterministic

## R3 EGA-498 Goal neglect + Project imbalance — requires F1/F2
Similar dependency. Rolling window from time context, project share from execution evidence, sparse evidence guards

## R4 EGA-499 Durable postponement evidence — HITL + migration lock
Definition: incomplete Task with existing planned_for_date moved later by approved mutation; not first planning/pull-forward/completion cleanup/retry.
Tasks: enumerate planned_for_date writers, add task_planning_history table (id, owner, task_id, old_date, new_date, source, occurred_at), record via canonical Task use cases, idempotency, tests for all paths. Threshold 2/14d -> friction.
Migration lock required via Coordinator queue.

## R5 EGA-500 Typed recommendations
Compose R1-R4 signals into kind/severity/evidence/recommendation, deduplicate, no productivity score

## R6 EGA-522 Cross-feature projection — wait for stable downstream contracts
Daily Operator / Weekly Review / Health Coach consume only, no local recalculation

Ledger: R1 now, R2/R3 blocked on F1/F2, R4 HITL decision needed, others sequential.
