# Health Coach Plan — 2026-08-27

Branch: feat/health-coach
Worktree: .worktrees/health-coach
Base: 1a01bf3d03bf2394358f204448d247f1b04d544e

Parent EGA-491 — lightweight, non-medical, workload/recovery only.

## H1 EGA-501 Workload snapshot — requires F1/F2
Use canonical session evidence. Fields: rolling workload, active days, session density, longest/avg session, sufficiency (sufficient/insufficient/provisional/suspect)
Tasks: application/src/health/workload-snapshot.ts + data-access + contracts + server/api-client + web Today section + mobile

## H2 EGA-502 Deterministic recommendations — requires H1
Non-medical copy, evidence included, no mutation
Tasks: health/recommendations.ts rules, thresholds

## H3 EGA-503 Weekly trend — wait for Review contract (W1)
## H4 EGA-504 Operator signal — wait for Operator O1
## H5 EGA-528 Notification nudges — wait for canonical notification subsystem (PR #181) + F1 + H2
Notification type, cooldown, quiet-window via time context, provision/suspect suppression

Ledger: H1/H2 blocked on F1/F2; log BLOCKED until foundations land.
