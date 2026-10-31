# PR #339 - Workspace Shell Persistent (Performance)

## Summary
W1-W4 consolidated the app shell into a single persistent shell (no nested AppShell), preserved realtime, added/rewrote E2E shell tests. W5-W7 optimized initial drawer loads (non-blocking primary action, parallelized Today/Tasks reads). W9-W10 isolated timer ticks and preserved canonical nav.

## W12: Post-Dublin Measurements (2026-10-31)
- Region: dub1 (Vercel)
- Environment: review/pre-production context (no production Fluid Active CPU snapshot attached)
- Focus: stability of shell persistence under navigation (no route remount of shell), drawer load fan-out reduced
- Findings (measured/observed):
  - Shell remains mounted across primary navigation; no obvious remount churn observed in code paths (single AppShell instance).
  - Drawer reads parallelized where applicable; counts use head queries where introduced.
  - Timer updates isolated with bounded history to avoid uncoordinated re-renders.
- Limitations:
  - No production Fluid Active CPU metric available in this worktree/session. 
  - No automated benchmark script committed here (reserved measurement scripts not present). 
  - Results are code-path observations and local sanity checks; not a production % claim.
- Recommendation: collect Vercel Fluid metrics on a deployed review build in dub1 with representative traffic before making percentage CPU claims.

## No invented 50% CPU
No 50% CPU reduction figure is asserted by this change set. Any performance targets must be backed by production measurements.

## Notes
- vercel.json regions preserved: ["dub1"]
- No secrets committed
- Changes limited to docs/performance and reserved measurement scripts (none required/created)
