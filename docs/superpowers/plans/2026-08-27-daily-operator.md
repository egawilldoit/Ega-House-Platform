# Daily Operator Plan — 2026-08-27

Branch: feat/daily-operator
Worktree: .worktrees/daily-operator
Base: 1a01bf3d03bf2394358f204448d247f1b04d544e

## Parent EGA-492 — replaces Dashboard, convergence on /today
Waves O1->O2->O3->O4->O5 sequential; O6-O8 deferred.

## O1 EGA-516 Canonical snapshot / default entry
Tasks:
- Application: today/operator snapshot use case consolidating web Today builders onto shared application/data-access; snapshot fields: sections, start-here, active Timer, tracked time, blockers, Goal/Project context, slots for Health/Friction/Inbox
- Web: auth root "/" -> /today, /dashboard compatibility redirect, remove second command truth
- Mobile: keep Today first tab via Hono/api-client
- Tests: routing, snapshot when signals absent, RLS

## O2 EGA-517 Deterministic proposal 3-6 Tasks
No mutation, explainable ranking (priority, due, focusRank, estimate, active Timer), reasons/evidence, local date/time-context id, stable candidate set for EGA-526 hash
Tests: bounded set, exclude completed/blocked, sparse days, ranking

## O3 EGA-526 Durable lifecycle
States generated->revised->approved->applying->applied/partially_applied/stale/dismissed
Persist: proposal id, revision, owner, date/context, hash, task ids/order, parent id, idempotency key, timestamps, result, AI ref
Tasks: migration operator_proposals, application use cases, concurrency/idempotency, stale detection, partial apply

## O4 EGA-518 Explicit approval/apply
Revalidate ownership/state, skip invalid, idempotent retry, refresh after apply, LLM cannot bypass

## O5 EGA-519 Replan
Compare applied baseline (from 526) with current state, deterministic, no noisy duplicates, parent lineage, no Timer interruption

## O6 EGA-520 Close Day — separate daily reflection owner, preserve Shutdown strings
## O7 EGA-527 Start Day — absorb Startup planner evidence
## O8 EGA-521 AI explanation — provider-neutral, reuse Inbox AI port

Ledger: O1->O2->O3->O4->O5 now; O6-O8 later.
