# Shell Persistence Evaluation — P2

Date: 2026-08-26 · Branch: ui/web-v2 · Head: b2f1c5a

## Question
Should the authenticated workspace shell (Sidebar, TopBar, CommandPalette, metrics) be moved into a persistent route-group layout `apps/web/src/app/(workspace)/layout.tsx` so it does not remount on navigation?

## Current implementation (after P0/P1)
- `AppShell` is an async Server Component imported in each authenticated `page.tsx`.
- `getWorkspaceShellMetrics`, `getSidebarProjects`, `getSidebarGoals` are wrapped with `React.cache` (request-level memoization).
- `TopBar` / `Sidebar` are Client Components; they remount on each navigation because the Server Component tree is re-executed per page.

## What React.cache does and does not do
- `React.cache` deduplicates expensive Supabase queries **within a single server render/request**. It prevents the N+1 waterfall where dashboard panels re-fetch the same data as the shell.
- It does **not** make the shell persistent across navigations. Each navigation triggers a new server render, a new `AppShell` execution, and a new client remount of `Sidebar`/`TopBar`. The cache is per-request, not cross-navigation.
- Claims that `React.cache` makes the shell "persistent" or "stable across navigation" would be false. Performance claims must be precise: it reduces duplicate queries per request, but does not avoid shell remount.

## Persistent layout alternative
- Next.js route groups `(workspace)` preserve URL structure: `app/(workspace)/dashboard/page.tsx` still serves `/dashboard`.
- A shared `app/(workspace)/layout.tsx` would render `Sidebar`, `TopBar`, `CommandPalette` once, and only the `children` (page content) would change on navigation. This gives true persistence: client state, scroll, and focus are preserved, and shell data can be fetched once per layout.

## Evaluation — is a move safely possible now?
**Risk assessment:**
- Auth boundaries: `(workspace)` would need to handle auth redirects for all authenticated routes, while public routes (`/`, `/login`, `/signup`, `/auth/*`, `/oauth/consent`, `/home`) must remain outside. Moving 15+ pages requires updating middleware, `proxy.ts`, and `getCurrentUser` checks.
- Metadata: `layout.tsx` cannot export `metadata` that depends on per-page searchParams; page-level metadata must remain in each `page.tsx`.
- Tests: `src/components/layout/editorial-shell.test.ts` asserts `AppShell` imports and structure; moving to group layout would require updating those tests.
- Incremental risk: The current `AppShell` per-page approach is well-tested (140 tests pass) and the performance gain from `React.cache` is measurable but not yet proven to be a bottleneck in production (Supabase counts are cheap, ~20-50ms).

**Decision: Defer persistent group layout.**
- Keep `AppShell` per-page with `React.cache` for request-level dedupe.
- Document the precise behavior (this file) and avoid claiming cross-navigation persistence.
- Future work can safely introduce `(workspace)/layout.tsx` in a dedicated PR with:
  - `git mv` for each authenticated route
  - Updated `proxy.ts` and `auth-service` checks
  - Updated `editorial-shell.test.ts` and `app-shell` tests
  - Manual verification that URLs, metadata, and searchParams still work

## Precise performance claims (after P0/P1)
- Shell data (projects 24 + tasks 1000 scan, goals 50, metrics 5 counts) is fetched **once per request** via `React.cache`, not once per panel.
- No cross-navigation persistence; shell remounts per navigation, but subsequent navigations benefit from Next.js prefetch and `Link` code-splitting.
- Font waterfall eliminated via `next/font`, not via shell persistence.
- Timer tick remains isolated to `ActiveTimerDisplay` (1s interval does not re-render page).

## Evidence
- `apps/web/src/lib/workspace-shell.ts: export const getWorkspaceShellMetrics = cache(...)` — request-level
- `apps/web/src/components/layout/app-shell.tsx: const getSidebarProjects = cache(...)` — request-level
- `git diff --name-only origin/main...HEAD | grep '^apps/mobile/'` → NO OUTPUT (shell changes are web-only)
- `npm run web:build` with dummy env still passes (34/34 static)
