# PR10 — Compatibility Cleanup & Readiness: Read-Only Inventory + Evidence Plan

**Status:** Inventory phase (read-only). No repo file was modified, deleted, or committed to produce this document — this file is the single deliverable of the inventory phase.
**Branch:** `arch/10-compat-cleanup-readiness` (scratch, NOT pushed)
**Base:** `origin/arch/04-project-goal-application-core` @ `3ef94abad841b9c39417c77ad45fa574679b7dd9`
**Date:** 2026-08-09
**Remote state verified via `git ls-remote origin`:** `arch/05-hono-project-goal-transport` @ `be190caf` ✓ pushed · `arch/07-web-app-workspace` @ `70e1204` ✓ pushed · `arch/06-api-client`, `arch/08-native-project-goal-ui`, `arch/09-unified-ci` — **NOT on remote** (in progress; local scratch branches exist for 06/09).
**Authoritative design reference:** `~/ega-house-worktrees/pr9-ci/UNIFIED-CI-DESIGN.md` (377 lines; read in full).

---

## 0. Headline findings

1. **No per-stage workflows were added after PR4.** `git ls-tree` of `.github/workflows/` on `origin/arch/05`, `origin/arch/07`, local `arch/06`, local `arch/09` shows the identical 13-file set as arch/04. PR10's workflow deletions are exactly the 7 obsolete files identified in UNIFIED-CI-DESIGN §6 (pr2-validator, pr2-lock-refresh, pr3-validator, pr4-validator, architecture-stack-validation, mcp-integration-ci, public-signup-ci) + `sonarcloud.yml.disabled`.
2. **PR7 moved `src/lib/**` wholesale → `apps/web/src/lib/**`** — the compatibility shims survived the move byte-identical; all shim importers (78 files) now live inside the web app. Mobile and packages never import the shims. The `pr3` compat-authority proof hardcodes the **old `src/lib/...` paths → stale on any post-PR7 head** (dormant, because pr3 triggers are branch-pinned, but the migrated `package-purity.mjs` must use new paths).
3. **ESLint duplication after PR7: resolved, not duplicated.** `arch/07` root `eslint.config.mjs` imports `apps/web/eslint.config.mjs` + adds `**/test-results/**` ignore + the ega-runner override. Root config is a thin composition layer — document, don't change.
4. **`pr2-workspace-lock-refresh.yml` is mutating** (`contents: write`; `git commit` + `git push` of a regenerated lock) — never fold into unified CI; delete with merge evidence; regeneration becomes a documented local command.
5. **Inherited lint debt (39 errors / 53 warnings live)** is what makes `architecture-stack-validation.yml` red on every arch push; it is pre-migration debt, not a migration regression, and PR9's baseline mechanism is what distinguishes the two.
6. **`apps/hermes-sidecar/` is untracked in the MAIN checkout (`~/ega-house`)** — verified `?? apps/hermes-sidecar/`. **Explicit non-candidate: never delete, never modify.**

---

## 1. Compatibility facades (shims)

All paths below are on the arch/04 base; **after PR7 they live at `apps/web/src/lib/...`** (verified via `git ls-tree origin/arch/07-web-app-workspace` — same filenames, moved). Importers on arch/07: **78 files, 100% inside `apps/web/src`** (verified `git grep`), plus one dormant reference in `pr3-contracts-domain-validation.yml` (the proof itself). `apps/mobile` does **not** import any shim (its `@/` alias resolves to `apps/mobile/`, which has no `lib/contracts`).

| Candidate | Content / current status | Importers (rg evidence, arch/04 head) | Replacement authority | Deletion evidence required | Safe-to-delete window |
|---|---|---|---|---|---|
| `src/lib/contracts/mobile.ts` | **Pure re-export** `export * from "@ega/contracts/mobile"` | 17 importing files (mobile API routes `src/app/api/mobile/**`, `src/lib/validation/mobile.ts`, agent-task-handlers, etc.) | Direct `@ega/contracts/mobile` imports — web already has `@ega/contracts` dep (arch/07 `apps/web/package.json` deps verified) | (1) mechanical rewire PR; (2) `rg` zero-import proof (`rg -l '@/lib/contracts/mobile' apps/web/src` → empty); (3) unified CI green (web typecheck/build) on same head; (4) compat-authority proof (pr3 inline → `scripts/ci/package-purity.mjs`) updated to new paths or web-side entries dropped (keep `apps/mobile/types/*` entries) | **needs-proof** — after PR9 (needs unified CI + scripts/ci) AND after PR7 topology. Not a delete-with-proof-of-death: it has live importers; deletion = rewire PR |
| `src/lib/contracts/agent.ts` | **Pure re-export** `export * from "@ega/contracts/agent"` | 10 importing files (agent-task-service, http/agent-*, mcp/server.ts, etc.) | Direct `@ega/contracts/agent` | same as above | **needs-proof** — after PR9 + PR7 |
| `src/lib/project-archive.ts` | **Pure re-export** `export * from "@ega/domain/projects"` (38 B) | 2 importing files (`src/app/tasks/projects/actions.ts`, `[slug]/page.tsx`) | Direct `@ega/domain/projects` | rewire (trivial, 2 sites) + rg zero-import + unified green | **needs-proof** — high confidence; after PR9 + PR7 |
| `src/lib/goal-archive.ts` | **Pure re-export** (GOAL_ARCHIVE_STATUS, GOAL_VIEW_VALUES, isGoalArchivedStatus, normalizeGoalViewFilter, GoalViewFilter) | 2 importing files (goals actions/page) | Direct `@ega/domain/goals` | rewire + rg zero-import + unified green | **needs-proof** — high confidence; after PR9 + PR7 |
| `src/lib/task-domain.ts` | **MIXED: re-exports (12 values + 4 types from `@ega/domain`) + real logic** (`formatTaskToken`, `getTaskStatusTone`) — web-presentation helpers | **52 importing files** (largest shim surface) | Re-exports → `@ega/domain`; helpers are legitimately web-app code | NOT a plain deletion: logic must stay (move/rename into a web helper module or leave in place); only re-export lines are removable | **keep by default**; optional "strip re-exports" refactor post-PR9, needs-proof |
| `src/lib/goal-health.ts` | **MIXED: re-exports + FormData helper** (`toGoalHealthWriteValue`), label/tone helpers | 5 importing files (goal forms/components) | Helpers are web-only; re-exports → `@ega/domain/goals` | same as task-domain | **keep by default**; optional refactor, needs-proof |
| `src/lib/goal-next-step.ts` | **MIXED: re-exports + FormData reader + preview truncation** (`getGoalNextStepPreview`) | 4 importing files (goal forms) | Helpers web-only; re-exports → `@ega/domain/goals` | same | **keep by default**; optional refactor, needs-proof |
| *(proof-scope)* `src/lib/task-recurrence.ts` | Real recurrence-parsing helper; **listed in pr3 compat proof** (must import `@ega/domain`) | 8 importing files | none (real code) | not a shim — keep; only relevant to proof migration | never |

**Assessment:** the four pure re-export facades add no functional value post-PR7 (only diff-minimization value, which dies with the migration); retiring them is a mechanical rewire, not a proof-of-death deletion. The three logic-bearing modules are web helper code wearing shim names — PR10 should treat them as keep (optionally strip re-exports). The pr3 proof's hardcoded paths (`src/lib/contracts/mobile.ts`, `src/lib/contracts/agent.ts`, `src/lib/task-domain.ts`, `src/lib/task-recurrence.ts`, `apps/mobile/types/{auth,tasks,today}.ts`) are stale on post-PR7 heads — PR9's `package-purity.mjs` must migrate them to `apps/web/src/lib/...` or drop the web-side entries.

---

## 2. Temporary per-stage workflows (13 files on every branch — no pr5/pr6/pr7/pr8/pr9 workflows exist anywhere; verified on origin/arch/05, origin/arch/07, local arch/06, local arch/09)

| Workflow | What it validates | Replacement authority (unified CI / other) | Deletion evidence required (UNIFIED-CI-DESIGN §6.1) | Safe window |
|---|---|---|---|---|
| `pr2-workspace-validation.yml` | diff hygiene vs pinned `PR2_BASE_SHA d71d689`; single root lock; framework pins; `npm ci`; resolution proofs; mobile doctor/typecheck/test/bundle; arch fixtures; agent-context; runner; root typecheck/test/build; generated outputs untracked | unified `workspace` (workspace-proofs.mjs, npm ci, audit, purity, security, check/test:architecture), `mobile`, `regressions`, `web` jobs | (1) arch/02 merged; (2) coverage mapping old-step→unified-job + green unified run on SAME head SHA; (3) `rg -l 'pr2-workspace-validation'` empty outside docs | **after-PR9** (unified green on same head — no validation vacuum; disable in PR9, delete in PR10) |
| `pr2-workspace-lock-refresh.yml` | **MUTATING maintenance**: `npm install --package-lock-only` → auto-commit + auto-push (`contents: write`, verified lines 15/86/87); removes nested mobile lock | **never folded into validators**; replacement = documented local command `npm install --package-lock-only --ignore-scripts --no-audit --no-fund` + unified `workspace` proves lock↔manifest consistency every run | (1) trigger branches (arch/02, arch/03) merged; (3) no refs; mutation behavior itself is the deletion rationale | **after-PR9** — top confidence |
| `pr3-contracts-domain-validation.yml` | PR3 ancestry vs `PR3_BASE_SHA cf6ec0a`; one-shot scope guards (NOT migrated); manifest↔lock proofs; purity regex scans; **compat duplicate-authority proof (paths STALE post-PR7)** | unified `workspace` (package-purity.mjs, workspace-proofs.mjs) + `contracts`/`domain` jobs | §6.1 + proof-path migration note (web-side entries → `apps/web/src/lib/...` or dropped) | **after-PR9** |
| `pr4-project-goal-application-validation.yml` | PR4 ancestry vs `PR4_BASE_SHA 9dcf207`; scope guards; **actor-identity proof; repository-trust proof** (crown jewels) | unified `workspace` step 7 = `scripts/ci/security-proofs.mjs` (permanent) + `application`/`data-access` jobs | §6.1 | **after-PR9** |
| `architecture-stack-validation.yml` | **LIVE-RED today**: both jobs fail at `Lint web root` — `✖ 92 problems (39 errors, 53 warnings)` (run `31311061829`, job `93238850636`, 2026-08-09; 14+ consecutive red arch runs); pinned-main-baseline job obsolete once unified validates main | unified workflow (all areas) + lint-baseline mechanism (§8 of design) — must not inherit the red-lint failure mode | §6.4: coverage mapping + green unified same-SHA + lint baseline in place | **after-PR9** |
| `mcp-integration-ci.yml` | path-scoped: audit (only place audit ran), scoped mcp eslint, mcp tests, typecheck/build | audit → unified `workspace` step 5 (now always-on); scoped lint → `lint-changed`; mcp tests inside `npm test` (web job); typecheck/build → `web` | §6.1.4 **double-run evidence**: PR touching `src/lib/mcp/**` where unified == old conclusions on identical SHA | **after-PR9** |
| `public-signup-ci.yml` | path-scoped: focused 11-file tests, full `npm test`, scoped eslint, build | same fold (focused tests ⊂ `npm test`; lint via `lint-changed`) | §6.1.4 double-run evidence | **after-PR9** |
| `sonarcloud.yml.disabled` | disabled; `workflow_dispatch`; lint+build+coverage+sonar-scanner; **does NOT reference `sonar:export-reliability`** (verified body) | none (dead) | `.disabled` suffix + no refs + orphaned script proof | **after-PR9** (or anytime — already inert; keep PR9's disable-then-delete sequencing) |
| **KEEP** `slack-pr-ready.yml` | notifier (evaluates all checks, ignores self, Vercel/Macroscope optional) | — | — | never |
| **KEEP** `mobile-apk-manual.yml` | manual APK artifact build | — | — | never |
| **KEEP** `ega-weekly-reviews.yml` | operational cron POST `/api/cron/sendWeeklyReviews` (CRON_SECRET) — **failing on schedule; out of validation scope; flag to owner** | — | — | never (fix separately) |
| **KEEP** `ega-daily-emails.yml.disabled`, `ega-task-reminders.yml.disabled` | disabled operational crons | — | owner sign-off only if ever deleted | keep unless owner confirms dead |

**Staleness hygiene signal:** pinned `PR2/PR3/PR4_BASE_SHA` env vars go stale immediately after their branches merge — cheap proof the workflow is dead.

---

## 3. Tracked junk / debt candidates

| Candidate | Current status | Importers / consumers (rg evidence) | Replacement authority | Deletion evidence required | Safe window |
|---|---|---|---|---|---|
| `scripts/ega-runner/node_modules/**` (248 tracked files) | **Deliberate** — standalone npm project with committed deps; present on main, arch/04, arch/07 (verified counts) | runner typecheck + PR-loop regressions (unified `regressions` job); design doc §2.4/§9.4 explicitly exempts it from hygiene bans | none — keep | **none — NON-CANDIDATE** | never |
| `test-results/.last-run.json` (45 B) → `apps/web/test-results/.last-run.json` post-PR7 (moved, still tracked) | Playwright runtime artifact, tracked since `b02801e "mvp v1 shiped"`; **not gitignored** (arch/04 & arch/07 `.gitignore` verified — no entry); no consumer | none (45 B JSON, regenerated every playwright run) | delete + add ignore `**/test-results/.last-run.json` | regenerated artifact + zero refs + would be flagged by unified `hygiene` generated-artifact proofs | **after-PR7** topology (path is `apps/web/test-results` on PR10 head) — **top confidence** |
| `replace.js` (6.7 KB), `replace2.js` (464 B), `replace3.js` (1.3 KB) | One-shot refactor scripts from earlier feature work (sed-style edits to dashboard/task pages); **targets already gone**: `DashboardOptimizedView.tsx` deleted (count=0), `src/app/tasks/page.tsx`/`create-task-form.tsx` moved to `apps/web` by PR7 | zero references repo-wide (verified `git grep`) | none | rg no-refs + targets deleted/moved | **after-PR9** — **top confidence** (inert today) |
| `backups/prod-pre-sprint2-full-20260504.dump` (278 KB) | **Production DB dump committed** (added in `a8c757c "Add SonarCloud analysis workflow"`) — sensitive-data exposure risk | none found; verify no restore pipeline/scripts reference `backups/` before deleting | none | rg no-refs + **owner sign-off** (prod backup — confirm nobody relies on it) | **after-PR9**, needs owner confirmation |
| `evidence/EGA-422-attempt-2/*` (4 files: changed-files.txt, head.txt, status.txt, uncommitted.patch; 83 B–1.9 KB) | Session debug artifacts committed in `e5ad8c6 "chore: commit uncommitted changes..."` | none | none | rg no-refs | **after-PR9** — **top confidence** |
| `sonar:export-reliability` script + `scripts/export-sonar-reliability-issues.mjs` | **Zero consumers**: only `package.json` self-reference (verified `git grep`); `sonarcloud.yml.disabled` doesn't call it; no workflow/docs refs | none | none | rg proof (only package.json + deleted workflow) | **after-PR9** (with sonarcloud.yml.disabled) — **top confidence** |
| `test:session`, `test:timer-recovery`, `test:auth-session:e2e` (root scripts) | **Not referenced by any workflow** (verified grep of `.github/workflows/`) BUT live web test entry points; on arch/07 rewired to `@ega/web` workspace (`apps/web/tests/auth-session.e2e.spec.ts` moved by PR7) | local dev/test tooling | none — keep | n/a | **keep** (not junk; PR10 documents, does not delete) |
| `preflight:hermes-skills` + `scripts/agent/preflight-hermes-skills.mjs` | Not in any workflow, but **documented** in HERMES_MASTER_PROMPT.md, docs/agent-context/testing-and-validation.md, docs/architecture/hermes-execution.md | docs + package.json | none — keep | only deletable if docs updated simultaneously | **keep** unless docs change; needs-proof |
| ESLint config duplication root vs `apps/web` | **No duplication on arch/07** — root config imports `apps/web/eslint.config.mjs` (verified) + adds `**/test-results/**` ignore + runner override | — | — | — | **never** — document only (root config remains as composition layer) |
| `sonar-project.properties` | orphaned once sonarcloud.yml.disabled is deleted | sonar config for SonarCloud.io | keep or delete | owner sign-off (SonarCloud may be re-enabled) | needs owner |
| Root agent-tooling/docs (`.agents/`, `.codex/`, `.hermes/`, `.opencode/`, `.pi/`, `skills-lock.json`, `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`, `HERMES_MASTER_PROMPT.md`, `ARCHITECTURE.md`, `WORK_ANALYTICS_AUDIT_REPORT.md`, `ega-419-security-audit-report.md`) | Pre-existing on main (verified `git ls-tree origin/main`); intentional guardrails-era tooling + audit evidence | agents/docs | — | — | **NON-CANDIDATES** (document) |
| **`apps/hermes-sidecar/` (MAIN checkout only)** | Untracked in `~/ega-house` (`?? apps/hermes-sidecar/` verified); not in worktrees | — | — | — | **NEVER — explicit non-candidate, never delete or modify** |

---

## 4. Deployment / readiness surface — DOCUMENT ONLY (no changes)

- **`vercel.json`**: stub `{ "$schema": ... }` on arch/04 AND arch/07; **no `apps/web/vercel.json`** exists (verified). No builds/rewrites/functions configured. Deploys happen via Vercel git integration **outside the repo** — nothing to change in PR10; document that no in-repo deploy workflow exists (none among the 13).
- **No CI deploy workflow exists** — deployment status only surfaces through `slack-pr-ready.yml`, which treats Vercel checks as **optional** (verified design doc §2.1).
- **pm2**: referenced only in vendored `.agents/next-best-practices/self-hosting.md`; **no pm2 config files tracked** (verified `git grep -il pm2`). Document only.
- **`scripts/ega-runner/`**: the agent runner (standalone npm project, tracked lock + node_modules; `src/vercel.ts` is its Vercel API client). Consumed by unified CI `regressions` job — **never delete**; document as infrastructure, not deployment.
- **`ega-weekly-reviews.yml`**: operational cron, failing on schedule — **not** a validation concern; PR10 body must flag it to the owner (fix separately; do not conflate with CI health).
- **PR10 readiness doc items**: (a) confirm `unified / *` check names on a merged main head post-PR9; (b) recommend branch protection required checks = `unified / *` only (admin action, outside repo files); (c) record lock-regeneration command in `docs/architecture/platform-monorepo.md`.

---

## 5. Lint baseline — inherited debt vs migration regressions

- **Baseline (authoritative, live-captured 2026-08-09, CI run `31311061829`): 39 errors / 53 warnings** (`✖ 92 problems (39 errors, 53 warnings)` at step `Lint web root` of both `architecture-stack-validation.yml` jobs). Handoff figure was 39/52 — **one warning drifted**, which is exactly what the PR9 baseline mechanism exists to surface.
- **This is pre-migration debt on main**, not a PR1–PR9 regression: full-repo `npm run lint` fails identically on `pinned-main-baseline` (checkout of `PINNED_PR1_MAIN_SHA 7b997c4` == current `origin/main` tip). Migration PRs did not introduce it.
- **Local re-capture on this head was not possible**: `eslint` is absent from the worktree `node_modules` (`npm ls eslint` → empty) and `npm install` is forbidden in this phase. The authoritative capture is PR9's `lint:report --capture` → `scripts/ci/lint-baseline.json` (live capture takes precedence over handoff numbers; per-file counts are the keys — PR7's `src/** → apps/web/src/**` move requires re-capture after PR7).
- **Distinction mechanism (PR9, do not re-invent):** `lint-changed` = blocking, per changed file vs baseline, new files must be 0 problems; `lint-report` = full-repo, non-blocking, fails only on drift (>+1 warning or new error). **PR10 readiness flip:** when baseline → 0/0 (or owner approves), `lint-report` flips to blocking and the baseline file is retired; `lint-changed` stays as the fast path. Post-PR7 note: root eslint config ignores `**/test-results/**`; scope = web (apps/web config) + runner + packages.
- PR10's own diff (docs, workflow deletions, any rewire) must introduce **zero new lint problems** in touched files.

---

## 6. What PR10's implementation phase must wait for

1. **PR9 merged + green on a post-PR8 head** with every §5 coverage row exercised (no existence-guard skipped) — per design §9, PR9 must NOT be finalized until PR8's topology exists. PR10 deletes old workflows only after unified CI is green on the SAME head SHA (no validation vacuum; disable in PR9 → delete in PR10).
2. **PR7 topology merged** — shim paths (`apps/web/src/lib/...`), `test-results/.last-run.json` path, root-script rewires (`web:*`, `test:*` delegation) all assume it.
3. **PR5/PR6 topology merged** — root-script contract (`server:*`, `api-client:*`) fulfilled so unified `server`/`api-client` jobs are active, not skipped.
4. **Merge evidence for all trigger branches** (arch/02…arch/09) — `git branch -r --merged origin/main` + `gh pr view` state/mergedAt; stale `PR2/PR3/PR4_BASE_SHA` pins as the hygiene signal.
5. **Owner sign-offs**: `backups/*.dump` (prod backup), disabled crons (ega-daily-emails / ega-task-reminders), `sonar-project.properties`.
6. **Live lint baseline capture** (PR9 `lint:report --capture`, post-PR7 re-capture) as the authoritative numbers for the readiness flip.
7. **Double-run evidence** for path-scoped folds (mcp-integration-ci, public-signup-ci): a PR touching their paths where unified conclusions == old conclusions on identical SHA.

---

## 7. Appendix — evidence artifacts captured this phase

- `git ls-remote origin`: arch/05 @ be190caf, arch/07 @ 70e1204 pushed; arch/06/08/09 absent; main @ 7b997c4.
- `git ls-tree` `.github/workflows/` identical (13 files) on origin/arch/05, origin/arch/07, local arch/06, local arch/09.
- `git ls-tree origin/arch/07`: `apps/web/src/lib/contracts/{mobile,agent}.ts`, `task-domain.ts`, `project-archive.ts`, `goal-archive.ts`, `goal-health.ts`, `goal-next-step.ts` present; root `src/` count = 0.
- `git grep` arch/07: 78 web files import shims; only non-web reference = pr3 workflow proof.
- `git ls-files` arch/04: 248 runner node_modules files; `test-results/.last-run.json` (45 B); `replace*.js` (6.7 KB/464 B/1.3 KB); `backups/prod-pre-sprint2-full-20260504.dump` (278 KB); `evidence/EGA-422-attempt-2/*` (4 files) — all also present on `origin/main`.
- `git log --diff-filter=A`: test-results/.last-run.json ← b02801e; backups/ ← a8c757c; replace.js ← 837e7a6; evidence/ ← e5ad8c6.
- pr3 workflow lines 139–168: compat proof hardcodes `src/lib/contracts/{mobile,agent}.ts`, `src/lib/task-domain.ts`, `src/lib/task-recurrence.ts`, `apps/mobile/types/{auth,tasks,today}.ts`.
- pr2-lock-refresh lines 15/86/87: `contents: write`, `git commit`, `git push` — mutating confirmed.
- arch/07 eslint: root config imports `apps/web/eslint.config.mjs` (no duplication).
- Live lint: 39E/53W (run 31311061829, 2026-08-09); local re-capture blocked (eslint not installed; npm install forbidden).
- `?? apps/hermes-sidecar/` in `~/ega-house` (main checkout) — non-candidate.
