# Weekly Review Plan — 2026-08-27

Branch: feat/weekly-review-planning
Worktree: .worktrees/weekly-review-planning
Base: 1a01bf3d03bf2394358f204448d247f1b04d544e

Parent EGA-494 — dedicated weekly decision surface, not analytics.

## W1 EGA-510 Shared review read model — requires F0/F1/F2
Extract web weekly-review-page-service.ts into application; shared read model: saved review, weekly Task/session/Goal/blocker evidence, tracked summary; Hono route + mobile screen; preserve email flows; historical windows explicit input
AC: canonical week-boundary via time context, not now-dependent

## W2 EGA-511 Week-over-week comparison — requires W1
Adjacent windows, zero-denominator safe, same evidence source

## W3 EGA-513 Next-week objectives draft->approved — requires W1, migration lock
## W4 EGA-514 Historical browsing — owner-scoped, no mutation
## W5 EGA-512 Synthesis — consume Health/Friction, never duplicate
## W6 EGA-515 Approved objectives -> Operator context — no direct Task mutation

Ledger: all blocked on F0/F1/F2; W1 first after foundations.
