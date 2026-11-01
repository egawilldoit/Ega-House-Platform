# EGA House — Vercel Fluid Active CPU Optimization (perf/vercel-fluid-cpu-50)

## Status
- Branch: perf/vercel-fluid-cpu-50
- Base: origin/main @ 1bd39c3be574c95ca120bf27a64deb200738e39f
- PR: TBD (draft)
- Target: ≥50% reduction in Vercel Fluid Active CPU for equivalent traffic (pending production verification)

## Baseline
- Next.js: 16.4.3 (apps/web/package.json)
- React: 19.1.0
- Known historical: ~114 min / 180 min team (30d), Hobby 4h limit
- Pre-existing local change: supabase/.temp/cli-latest (not touched)

## Waves
Wave 0: Setup complete. Branch created from origin/main, docs initialized.

## Wave 1 - Realtime correctness + catch-up
- Fix: OwnerScopedRealtimeRefresh now tracks pending refreshes while hidden and triggers catch-up on visibilitychange. Preserves debounce/coalescing and unmount safety.
- Tests: owner-scoped-realtime-refresh.test.tsx passed (14/14).

## Wave 2 - App shell query optimization
- Change: AppShell sidebar project active-task counts now use per-project head-count queries (count: "exact", head: true) instead of fetching up to 1000 task rows and counting in JS.
- Rationale: reduces data transfer/serialization for shell; preserves counts and behavior.
- Tests: workspace-shell.test.tsx passed (13/13); home-routing.test.ts passed (5/5); home-dashboard/task-read-home tests passed (12/12).
