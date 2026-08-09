# EGA House Platform — Deployment & Migration Readiness

**Branch:** `arch/10-compat-cleanup-readiness` (Stage 10 of the architecture migration)
**Base:** `arch/09-unified-ci` @ `55a559cb2d544cd2ddcbecf334de08a76cbd8e6c`
**Date:** 2026-08-09
**Status:** factual snapshot of this branch head. Everything below is evidence-based
(run IDs, SHAs, and file paths are verifiable on the head).

---

## 1. Deployment topology (current vs post-PR7)

| Surface | On this base | After PR7 merges |
|---|---|---|
| Web (Next.js) | **Repository root** (`src/**`, root `package.json` scripts `build`/`start`/`typecheck`/`test`) | `apps/web` (moved by PR7; unified `web` job then uses `web:*` scripts) |
| Standalone server (Hono) | `apps/server` (PR5) | unchanged |
| Mobile (Expo) | `apps/mobile` (unchanged since PR2) | unchanged |
| Shared packages | `packages/{contracts,domain,application,data-access,api-client}` | unchanged |

### Standalone server environment

`apps/server` reads Supabase credentials at runtime (never baked into a build).
Preferred names: `SUPABASE_URL` + `SUPABASE_ANON_KEY`; the web-facing
`NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` pair is
accepted as a fallback so a deployment that already injects those values can run
the server without extra secrets (verified in `apps/server/src/env.ts`).

### Deployment mechanics

- **No in-repo deploy workflow exists** (verified across all workflow files on
  this head). Deploys happen via Vercel git integration outside the repo;
  `vercel.json` at the root is a stub with no builds/rewrites/functions, and no
  `apps/web/vercel.json` exists yet.
- `slack-pr-ready.yml` reports PR readiness and treats Vercel/Macroscope checks
  as optional — it is the merge guard (no branch protection required checks are
  configured on `main`; adding `unified / *` as required checks is a repo-admin
  action outside repo files, recommended once the stack merges).
- `mobile-apk-manual.yml` builds APK artifacts on `workflow_dispatch` (manual).

## 2. Retained compatibility surfaces (deliberately not deleted)

| Surface | Why it stays | Retirement path |
|---|---|---|
| `src/lib/**` shims (`contracts/mobile.ts`, `contracts/agent.ts`, `project-archive.ts`, `goal-archive.ts`, `goal-health.ts`, `goal-next-step.ts`, `task-domain.ts`, `task-recurrence.ts`) | Still consumed on this base: 78 files import them (all inside the root web app pre-PR7). They are pure re-exports of `@ega/contracts`/`@ega/domain` (except `task-domain.ts`, `goal-health.ts`, `goal-next-step.ts`, `task-recurrence.ts`, which carry real web-presentation logic) | After PR7 merges: mechanical rewire of importers to direct package imports + `rg` zero-import proof + unified CI green; logic-bearing helpers stay as web code under `apps/web` |
| `scripts/ega-runner/node_modules/**` (249 tracked files) + `scripts/ega-runner/package-lock.json` | Standalone npm project with deliberately committed deps (runner is infrastructure, consumed by unified `regressions` job) | Never — documented exception to hygiene bans |
| Legacy mobile Auth / Tasks / Today (`apps/mobile`, `src/app/api/mobile/**`) | Production mobile surface; unchanged by the migration | Out of first-wave scope |
| `apps/hermes-sidecar/` | Untracked in the main checkout; explicit non-candidate | Never delete or modify |
| `backups/prod-pre-sprint2-full-20260504.dump` | Production DB dump committed in `a8c757c`; **owner sign-off required** before any removal (zero references, but it is a prod artifact) | Pending owner decision |
| `ega-daily-emails.yml.disabled`, `ega-task-reminders.yml.disabled` | Disabled operational crons; owner sign-off only | Pending owner decision |
| `sonar-project.properties` | Orphaned once `sonarcloud.yml.disabled` was deleted; SonarCloud may be re-enabled | Owner decision |

## 3. CI ownership handoff (single validation authority)

Since PR9, `unified-platform-validation.yml` is the **only active validation
workflow** on this branch head. Triggers: `pull_request` + `push` on
`main`/`arch/**`, plus `workflow_dispatch`. Check names are stable job names
(`unified / workspace`, `unified / web`, …) for branch protection and the Slack
notifier.

Deleted by PR10 (all previously disabled or folded — no validation vacuum):

- `pr2-workspace-validation.yml.disabled` — superseded by unified `workspace`,
  `mobile`, `regressions`, `web` jobs
- `pr2-workspace-lock-refresh.yml.disabled` — mutating auto-commit workflow;
  regeneration is now a documented local command (see platform-monorepo.md)
- `pr3-contracts-domain-validation.yml.disabled` — superseded by `workspace`
  (purity/duplicate-authority proofs → `scripts/ci/package-purity.mjs`) +
  `contracts`/`domain` jobs
- `pr4-project-goal-application-validation.yml.disabled` — superseded by
  `workspace` (actor-identity/repository-trust proofs →
  `scripts/ci/security-proofs.mjs`) + `application`/`data-access` jobs
- `architecture-stack-validation.yml.disabled` — live-red on lint debt; fully
  superseded by unified jobs + baseline-aware lint
- `sonarcloud.yml.disabled` — dead disabled artifact; its only orphan
  (`sonar:export-reliability` + `scripts/export-sonar-reliability-issues.mjs`)
  deleted with it
- `mcp-integration-ci.yml` + `public-signup-ci.yml` — folded: mcp and
  signup/auth paths are all under the unified `web` scope (`src/**`), the
  always-on `lint-changed` gate replaces scoped eslint, the always-on
  `workspace` audit replaces mcp-only audit, and full `npm test` in the `web`
  job is a superset of both focused test lists.

Recorded fold residuals (accepted, documented in PR10 body): drizzle-only or
`eslint.config.mjs`-only PRs skip the unified `web` job (workspace/lint jobs
still run); pushes to the five merged `feat/*` branches (PRs #112, #115–#118)
no longer trigger CI (branches are inert post-merge).

### Known non-blocking CI observations on this head

- `unified / workspace` fails at the **always-on `npm audit` step** (high-severity
  prod dependency findings, `npm audit fix` available) — inherited dependency
  debt, same cause as the old `mcp-integration-ci` failures. Tracked as
  follow-up; PR10 does not change dependencies.
- Inherited lint baseline: **39 errors / 53 warnings** (captured 2026-08-09,
  `scripts/ci/lint-baseline.json`). Full lint is informational (`lint-report`);
  changed-path lint (`lint-changed`) is the blocking gate. When the baseline
  reaches 0/0 (or owner approves), `lint-report` flips to blocking.
- `ega-weekly-reviews.yml` (operational cron POSTing `/api/cron/sendWeeklyReviews`)
  fails on schedule — operational issue, not validation; flagged to owner, fix
  separately.

## 4. Validation evidence on this head

- Unified run on base SHA `55a559cb` (push to arch/09): run `31322502468` —
  `web` (typecheck/test/build), `server`, `api-client`, `mobile`, all package
  jobs, `lint-changed`, `lint-report`, `regressions`, `hygiene` green; `workspace`
  failed only at the audit step (see §3).
- PR10 validation executed locally on `arch/10-compat-cleanup-readiness` head
  (commit `55a559cb` + PR10 changes, 2026-08-09): `npm run test:architecture`
  (18/18 pass), `npm run check:architecture` (exit 0), `npm run typecheck`
  (exit 0), `npm test` (root vitest: 134 files / 977 tests passed), and the
  unified CI scripts
  `node scripts/ci/workspace-proofs.mjs`, `node scripts/ci/package-purity.mjs`,
  `node scripts/ci/security-proofs.mjs` — all "ALL CHECKS PASSED". Exact
  outputs are recorded in the PR10 body.
