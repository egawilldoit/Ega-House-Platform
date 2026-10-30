# EGA House — Vercel Fluid Active CPU Optimization (perf/vercel-fluid-cpu-50)

## Status
- Branch: perf/vercel-fluid-cpu-50
- Base: origin/main @ 1bd39c3be574c95ca120bf27a64deb200738e39f
- PR: https://github.com/egawilldoit/Ega-House-Platform/pull/337 (non-draft)
- Target: ≥50% reduction in Vercel Fluid Active CPU for equivalent traffic (pending production verification; no production deployment authorized)

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
- Change: AppShell sidebar project active-task counts now aggregate in a single tasks query selecting `project_id` (filtered to non-done) instead of one head-count query per project; rows are counted in JS. This reduces round trips (N -> 1) and drops the unused `status` column. An explicit `.limit(1000)` keeps the pre-existing Supabase row cap explicit.
- Correctness note: counts are derived from the fetched (capped) row set, so they are a lower bound when a project has more than 1000 active tasks. This row-cap undercount already existed on main; the PR does not introduce a net regression and does not claim exact counts beyond the cap. No RPC/schema change was added.
- Tests: workspace-shell.test.tsx; home-routing; home-dashboard/task-read-home. Request/count behavior covered by focused assertions; exact counts beyond the cap are not claimed.
