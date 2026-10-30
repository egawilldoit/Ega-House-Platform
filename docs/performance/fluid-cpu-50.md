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
- Change: On main the sidebar already fetched all non-done tasks for the selected projects in a single query (selecting `project_id, status`) and counted them in JS. The branch changes that to `select("project_id")` (drop the unused `status` column) and adds an explicit `.limit(1000)`. No query fan-out (N→1) was introduced by this PR; that was an intermediate implementation reverted by f2256448. The net delta is a smaller select and an explicit cap. No RPC/schema change.
- Correctness note: the limit is `1000` total rows across all selected projects (not per project). With multiple projects the combined set can reach 1000 before any single project exceeds it, so counts can be undercounted. This is an existing class of cap behavior (made explicit here) — treat counts as a lower bound under cap; exact counts beyond the cap are not claimed. No measured CPU benefit yet (target pending; no production deployment authorized).
- Tests: workspace-shell.test.tsx (13/13), home-routing.test.ts, home-dashboard/task-read-home. Wave 1 realtime tests now 18/18 (was 14).
