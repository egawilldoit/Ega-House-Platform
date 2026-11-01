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

## Repair pass (2026-11-01)
Verified against the live PR head and repaired in place on this branch:
- Removed the duplicate `/backlog` and `/work-analytics` route pages left at the legacy
  top-level paths (route groups do not contribute a URL segment, so both resolved to the
  same path); the workspace copies keep the mainline filters/actions/export behavior.
- Restored the public marketing home to `src/app/home/**`. The route move had pulled it
  inside `(workspace)`, which broke the public `/` import and mixed public content into
  authenticated chrome. `/`, `/login`, `/signup`, `/oauth`, `/auth` and `/api` stay outside
  the workspace layout.
- Restored mainline behavior for pages the move had rewritten with reduced content
  (Help directory + FAQ, Notifications inbox/timezone day headings/target links,
  Favorites list + row actions, Friction radar, Agents detail credentials, Timer header
  actions/CSV export, Shutdown date header, Review detail period copy, settings pages),
  keeping each page header inside the persistent shell.
- Repaired every moved import/mock (`@/app/<route>` -> `@/app/(workspace)/<route>`) in
  components, server actions, services and tests; removed the temporary duplicate modules
  the move had left behind so no second copy of a server action exists.
- Fixed the Home duplicate `baseModel` declaration and kept the streamed, non-blocking
  dashboard so slow secondary data cannot delay the primary actions.
- Route `loading.tsx` fallbacks now render content-scoped skeletons. They render inside
  `(workspace)/layout.tsx`, so painting a second shell frame there duplicated the chrome.
- Updated the architecture/security proof path globs to the moved routes; the actor-identity
  proof now fails closed on zero scanned files instead of silently passing.

## CI cost audit (2026-11-01)
Observed baseline: failed run 41158416188 summed ~626s of job time and failed early, so it
is a fail-fast sample, not a healthy-suite baseline.
- Removed the standalone `delivery-map` job: it installed the full dependency tree only to run
  one git-diff script and was not a required status. The mapping step and its step-summary
  contract now run inside `workspace`, which already checks out full history and installs.
- `lint-report` ran on every event with `continue-on-error`, so its required status could never
  fail; it protected nothing. It now runs only on `workflow_dispatch`/force-full. `lint-changed`
  remains the enforced changed-file regression gate.
- `contracts`, `domain`, `application`, `data-access`, `regressions`, `lint-changed` are now
  dependency-aware (packages / agent-context / code path filters, always on in force-full)
  instead of running the full install on docs-only changes.
- Every required check name is preserved; `hygiene` still rejects failed, cancelled or
  (in force-full) skipped dependencies. `scripts/ci/unified-ci-force-full.test.mjs` covers the
  new conditionals.
- Runner choice: GitHub-hosted standard runners on the public repository remain free; no
  Blacksmith migration is proposed because zero incremental spend is already met and the
  free-tier quota/spend-cap preconditions could not be verified from this environment.
- No measured runtime/cost delta is claimed: the optimized workflow has not yet completed a
  comparable full run at the time of this record.

## Residual risk (not verified here)
- Authenticated browser journeys (shell DOM identity across navigation, drawer mutations,
  owner isolation, timer recovery) need a non-production Supabase owner A/B fixture. No such
  environment or `E2E_AUTH_*` credentials were available in this checkout, so those suites skip
  rather than pass. Their static counterparts run in `web:test`.
- Vercel Fluid Active CPU: NOT MEASURED.


## Notes
- vercel.json regions preserved: ["dub1"]
- No secrets committed
- Changes limited to docs/performance and reserved measurement scripts (none required/created)
