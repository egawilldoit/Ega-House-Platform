# Unified Architecture / Validation CI — Design (Stage 9)

**Status:** Design (read-only discovery phase). No workflow, script, or source file was modified to produce this document.
**Branch:** `arch/09-unified-ci` (scratch, **not pushed**, identical to `origin/arch/04-project-goal-application-core` @ `3ef94abad841b9c39417c77ad45fa574679b7dd9`)
**Repo:** `egawilldoit/Ega-House-Platform`
**Date:** 2026-08-09
**Author:** Hermes subagent (Stage 9 design handoff)
**Mapping:** Migration sequence item 9 of `docs/architecture/platform-monorepo.md`: *"Enforce all boundaries and validation in unified CI."*

---

## 1. Executive summary

The repository currently carries **13 workflow files** (10 active, 3 disabled) that grew stage-by-stage with the migration. Four are **temporary per-stage validators** (`pr2-*`, `pr3-*`, `pr4-*`) whose triggers are pinned to now-merged or merging `arch/0x` branches; one "permanent" workflow (`architecture-stack-validation.yml`) is **live-red today** because it gates on full-repo lint while the repo carries an inherited lint baseline of **39 errors / 53 warnings** (verified in run `31311061829`, job `migration-head`, step `Lint web root`: `✖ 92 problems (39 errors, 53 warnings)`). No branch protection required checks exist on `main` (GitHub API returns no `required_status_checks`), so nothing currently forces a green full-platform validation before merge — the Slack notifier is the only guard.

This design replaces the stage-by-stage sprawl with **one validation workflow** (`unified-platform-validation.yml`) that covers every required validation: workspace/lockfile integrity, package purity and boundaries (including the rules already anticipating `apps/server`, `apps/web`, `@ega/api-client`), per-package tests, mobile checks, Runner and Agent-context regressions, production builds, diff hygiene, generated-artifact hygiene, scoped lint with a **baseline-aware regression check**, and dependency audit. It keeps the three genuinely non-validation workflows (Slack notifier, manual APK build, weekly-review cron) and specifies the **evidence checklist PR10 must satisfy before deleting** the obsolete ones.

The design is **topology-tolerant** (existence-guarded jobs) so it can land on top of the current stack state and become complete as PR5 (server), PR6 (api-client), and PR7/PR8 (web move + native UI) land — but PR9 must **not** be finalized until PR8's topology exists (see §9).

---

## 2. Current-state inventory

### 2.1 Workflows in `.github/workflows/` (13 files)

| File | Classification | Triggers | Jobs / what it validates | Depends on (root scripts / paths) |
|---|---|---|---|---|
| `pr2-workspace-validation.yml` | **Temporary (PR2)** | push `arch/02-npm-workspace-foundation`; PR → `arch/01-baseline-guardrails` | 1 job `workspace`: PR2 diff hygiene vs pinned `PR2_BASE_SHA d71d689`; single authoritative root lockfile (no `apps/*`/`packages/*` locks); framework pins (Expo ~54.0.34, RN 0.81.5, React 19.1.0, Next 16.2.12, Expo Router hoist 6.0.24, babel-preset-expo ownership); `npm ci`; resolution proofs (`npm ls`/`npm why`, single-RN-version walk); mobile doctor/typecheck/test/bundle; architecture fixtures + current-tree check; agent-context; runner typecheck + PR-loop; root typecheck/test/build (CI env placeholders); generated mobile outputs untracked; final mutation report | `mobile:doctor`, `mobile:typecheck`, `mobile:test`, `mobile:bundle`, `test:architecture`, `check:architecture`, `validate:agent-context`, `typecheck:ega-runner`, `test:ega-runner-pr-loop`, `typecheck`, `test`, `build` |
| `pr2-workspace-lock-refresh.yml` | **Temporary (PR2/PR3 maintenance)** | push `arch/02`, `arch/03` with paths (`package.json`, `apps/mobile/package.json`, `packages/*/package.json`, self) | 1 job `refresh-lock`: `npm install --package-lock-only`; workspace-discovery proof; removes nested mobile lock; commits + pushes regenerated `package-lock.json` (**mutating**, `contents: write`) | npm only |
| `pr3-contracts-domain-validation.yml` | **Temporary (PR3)** | push `arch/03-contracts-domain`; PR → `arch/02` | 1 job `contracts-domain`: PR3 ancestry + diff hygiene vs `PR3_BASE_SHA cf6ec0a`; **PR3 scope guards** (no `src/db/`, `drizzle/`, `src/lib/mcp/`, agent-* files); manifest/lock ownership proofs (`@ega/contracts`→`@ega/domain` only, domain zero deps, root+mobile shared deps, lock edges); `npm ci`; installed-resolution proofs; **contracts+domain purity regex scan** (no supabase/react/react-native/expo/next/drizzle/node:); **compat-file duplicate-authority proof** (legacy DTOs must re-export, not redefine); contracts/domain typecheck+test; architecture fixtures + tree check; mobile doctor/typecheck/test/bundle; agent-context; runner regressions; root typecheck/test/build; generated outputs untracked; mutation report | `contracts:typecheck`, `contracts:test`, `domain:typecheck`, `domain:test`, + same tail as PR2 |
| `pr4-project-goal-application-validation.yml` | **Temporary (PR4)** | push `arch/04-project-goal-application-core`; PR → `arch/03` | 1 job `project-goal-application`: PR4 ancestry + diff hygiene vs `PR4_BASE_SHA 9dcf207`; **PR4 scope guards** (same forbidden paths); manifest/lock proofs (`@ega/application`→`@ega/domain` only; `@ega/data-access`→`@ega/application` + no `next` dep; lock edges); `npm ci`; resolution proofs; **application purity scan** (no next/react/react-native/expo/supabase/drizzle/src-db/@/lib/supabase); **data-access no-Next scan**; **actor-identity security proof** (every `createAuthenticatedActor(` requires `requireAuthenticatedUser` + `user.id`, never formData/body/request); **repository trust proof** (repos scope by `owner_user_id` + `actor.userId`, consume request-scoped `SupabaseClient`, never service-role; construction sites require `requireAuthenticatedUser`); application/data-access typecheck+test; then same tail as PR2/PR3 | `application:typecheck`, `application:test`, `data-access:typecheck`, `data-access:test`, + same tail |
| `architecture-stack-validation.yml` | **Permanent (PR1-era), LIVE-RED** | push `arch/**`; PR → `main`, `arch/**` | 2 jobs: `pinned-main-baseline` (checkout `PINNED_PR1_MAIN_SHA 7b997c4` = current `origin/main` tip, Node 20) and `migration-head` (exact head, Node 20): PR1 diff hygiene vs pinned SHA; `npm ci`; agent-context; runner typecheck + PR-loop; root typecheck; **`npm run lint` (full-repo — fails on inherited debt)**; root test; root build (CI env placeholders); architecture guardrails "when available"; mutation report | `validate:agent-context`, `typecheck:ega-runner`, `test:ega-runner-pr-loop`, `typecheck`, `lint`, `test`, `build`, `test:architecture`, `check:architecture` |
| `mcp-integration-ci.yml` | **Permanent (scoped)** | PR → `main` with paths (`src/lib/mcp/**`, `src/db/mcp-schema.ts`, mcp routes, `drizzle/0037..0040`, journal, `drizzle.config.ts`, `package.json`, `package-lock.json`, `eslint.config.mjs`, self); push `feat/mcp-oauth-integration` | 1 job `validate`: `npm ci`; **`npm audit --omit=dev --audit-level=high`**; root typecheck; **scoped eslint** (mcp paths only); mcp tests (`npm test -- --run src/lib/mcp`); root build | `typecheck`, `test`, `build`, `npx eslint <paths>`, `npm audit` |
| `public-signup-ci.yml` | **Permanent (scoped)** | PR → `main` with paths (signup/auth/home/dashboard/layout `src/app`+`src/lib/auth`+`src/components/layout`, `package.json`, `package-lock.json`, `eslint.config.mjs`, self); push 4 `feat/*` branches | 1 job `validate`: `npm ci`; focused test list (11 files); full `npm test`; root typecheck; scoped eslint (auth/UI paths); root build | `test`, `typecheck`, `build`, `npx eslint <paths>` |
| `mobile-apk-manual.yml` | **Permanent (manual build)** | `workflow_dispatch` (build_type debug/release) | 2 jobs: `checks` (mobile doctor/typecheck/test/bundle) → `build-apk` (Java 17 + Android SDK, `expo prebuild --clean`, Gradle assembleDebug/Release, upload artifact) | `mobile:doctor`, `mobile:typecheck`, `mobile:test`, `mobile:bundle`, `mobile:prebuild:android` |
| `slack-pr-ready.yml` | **Permanent (notifier — KEEP)** | PR → `main` (opened/synchronize/reopened/ready_for_review); `check_suite`/`check_run`/`status` completed; `workflow_dispatch` | 1 job `notify`: evaluates all check runs/statuses (ignores self, treats Macroscope/Vercel as optional), sends Slack READY/NOT-READY, posts `<!-- slack-pr-ready-notified:{sha} -->` marker. No validation of its own | GitHub API only; consumes check names |
| `ega-weekly-reviews.yml` | **Permanent (cron — KEEP)** | schedule `0 0-4,22-23 * * 0,1`; `workflow_dispatch` | 1 job: POST `/api/cron/sendWeeklyReviews` with `CRON_SECRET`. **Failing on schedule today (3 failures on main)** — operational, not validation, out of scope | `APP_URL`, `CRON_SECRET` secrets |
| `sonarcloud.yml.disabled` | **Disabled** (`.disabled` suffix — GitHub ignores) | `workflow_dispatch` | SonarCloud scan: checkout, `npm ci`, lint, sonar-scanner | — |
| `ega-daily-emails.yml.disabled` | **Disabled** | schedule + dispatch | POST `/api/cron/*` email sends | — |
| `ega-task-reminders.yml.disabled` | **Disabled** | schedule + dispatch | POST `/api/cron/task-reminders` | — |

**Environment notes:** old permanent workflows use Node 20 + `checkout@v4`/`setup-node@v4`; migration workflows use Node 22 + `checkout@v5`/`setup-node@v6` (Node 22 matches local dev; unified CI standardizes on v5/v6/Node 22).

### 2.2 Root scripts relevant to CI (`package.json`)

| Script | Command | Role |
|---|---|---|
| `typecheck` / `test` / `build` / `start` / `lint` | `tsc --noEmit` / `vitest run` / `next build` / `next start` / `eslint` | Legacy root Next app (pre-PR7) — **post-PR7 these move/are rewired to `apps/web`** |
| `contracts:typecheck|test`, `domain:typecheck|test`, `application:typecheck|test`, `data-access:typecheck|test` | `npm run <x> --workspace @ega/<pkg>` | Per-package gates (all 4 packages exist) |
| `mobile:doctor|typecheck|test|bundle|prebuild:android` | workspace `@ega/mobile` | Mobile gates (jest, expo-doctor, expo export android) |
| `typecheck:ega-runner` | `tsc --noEmit -p scripts/ega-runner/tsconfig.json` | Runner regression |
| `test:ega-runner-pr-loop` | `node --import tsx --test scripts/ega-runner/test/pr-loop-*.test.mjs` | Runner PR-loop regression |
| `validate:agent-context` | `npm run test:agent-context && node scripts/agent/validate-agent-context.mjs` | Agent-context regression |
| `test:architecture` / `check:architecture` | `node --test scripts/architecture/check-boundaries.test.mjs` / `node scripts/architecture/check-boundaries.mjs` | Architecture fixture tests + live-tree boundary check |
| `db:*` | drizzle-kit | Not CI-gated (schema ownership out of wave) |
| `sonar:export-reliability` | script | Sonar helper (disabled workflow) |

### 2.3 Architecture checker (`scripts/architecture/check-boundaries.mjs`)

AST-based (`typescript`), scans all tracked source via `git ls-files`, resolves `@/` aliases per workspace root (`apps/mobile` → mobile; `apps/web/src` when present; else `src`). Current `BOUNDARY_RULES` (10):

| id | from | forbids | status |
|---|---|---|---|
| `mobile-no-application` | `apps/mobile/` | `@ega/application` | active |
| `mobile-no-data-access` | `apps/mobile/` | `@ega/data-access` | active |
| `mobile-no-server` | `apps/mobile/` | `apps/server/` path/specifier | **anticipates PR5** |
| `mobile-no-web` | `apps/mobile/` | `apps/web/`, `src/` | **anticipates PR7** |
| `mobile-no-db` | `apps/mobile/` | `src/db/`, `apps/web/src/db/` | active + **anticipates PR7** |
| `mobile-no-server-supabase` | `apps/mobile/` | `@/lib/supabase/server` etc. | active + **anticipates PR7** |
| `contracts-platform-neutral` | `packages/contracts/` | react, react-native, next, @supabase/ssr, @supabase/supabase-js, drizzle-orm, drizzle-kit | active |
| `domain-platform-neutral` | `packages/domain/` | same set | active |
| `api-client-platform-neutral` | `packages/api-client/` | expo, react, react-native, next, @supabase/*, `@ega/application`, `@ega/data-access`, `apps/`, `src/db/` | **anticipates PR6** |
| *(fixtures)* `check-boundaries.test.mjs` (11 tests) | mobile↔contracts/api-client allowed; mobile-no-application; contracts/domain neutrality; server-may-import-application | | active |

**Checker gaps to close in PR9/PR10 (design-only proposals):** `web-no-server` (web must not import `apps/server/` — per `platform-monorepo.md` web must not call back into its own server), `web-no-api-client` (web calls `@ega/application` directly; api-client is for native/external consumers — confirm with PR5/PR7 implementers), `server-no-mobile` / `server-no-web` (server must not import sibling app internals), plus API-client neutrality already covered.

### 2.4 Live CI health evidence (captured 2026-08-09)

- `Architecture Stack Validation` run `31311061829` (push to `arch/04`): both jobs fail at **`Lint web root`** — `✖ 92 problems (39 errors, 53 warnings)`. Same failure on every `arch/03`/`arch/04` push since 08-08 (14+ consecutive red runs).
- `PR4 Project Goal Application Core Validation` on `arch/04` push: **green** (the per-stage validator is the trustworthy gate today).
- `EGA Weekly Reviews` schedule runs on `main`: **failing** (operational cron; out of scope for PR9 but must not be confused with validation CI).
- `main` branch protection: **no required status checks configured** (API returns null) — nothing blocks a merge with red validation.
- `PINNED_PR1_MAIN_SHA` (`7b997c4`) == current `origin/main` tip; `origin/main..HEAD` = 91 commits (the whole open arch stack).
- `scripts/ega-runner/package-lock.json` **and** `scripts/ega-runner/node_modules/**` are deliberately tracked (runner is a standalone npm project with committed deps). Hygiene proofs must **not** ban tracked node_modules wholesale — only generated outputs (`apps/mobile/android|ios|.expo|artifacts`, `.next`, `apps/server/dist`, etc.).

---

## 3. Design goals and principles

1. **One validation pipeline, zero per-stage sprawl.** Exactly one workflow performs validation; per-stage workflows are retired (see §6).
2. **Topology-tolerant.** Jobs for `apps/server`, `apps/web`, `packages/api-client` exist from day one but self-skip (existence-guarded, the proven "when available" pattern from `architecture-stack-validation.yml`) until PR5/PR6/PR7 land. The workflow is green on the current stack head **and** complete after PR8.
3. **Baseline-aware lint.** Full-repo lint must never be a hard gate while the inherited debt (39 errors / 53 warnings) exists. Regressions are detected via scoped lint on changed paths compared against a captured per-file baseline; full lint runs as a non-blocking informational report with drift detection.
4. **Extract, don't duplicate.** The regex/purity/security proofs currently inlined in `pr3`/`pr4` workflows move to `scripts/ci/*.mjs` (single source of truth, runnable locally and in CI). PR9 may create these scripts; this design only specifies the contract.
5. **Parallel jobs, stable check names.** Every job is self-contained (checkout + Node 22 + `npm ci` with cache); job names become check names (`unified / <area>`) so branch protection and the Slack notifier read them cleanly.
6. **Security proofs are permanent.** Actor-identity and repository-trust proofs (PR4's crown jewels) run on **every** validation, not just during PR4.
7. **Hybrid triggers.** PRs to `main`/`arch/**` and pushes to `main`/`arch/**` all validate. Path filtering scopes only the heavy leaf jobs (mobile/server/api-client/web); workspace/package/regression/lint/hygiene jobs always run; any change to `package.json`, `package-lock.json`, or `.github/workflows/**` forces the full matrix.
8. **Diff and artifact hygiene are part of CI.** Whitespace/porcelain checks before install; generated-output untracked proofs after builds.

---

## 4. Target workflow set

### 4.1 File plan (PR9 outcome)

| File | Action | Rationale |
|---|---|---|
| `.github/workflows/unified-platform-validation.yml` | **NEW** | The single validation pipeline (§4.2) |
| `.github/workflows/slack-pr-ready.yml` | keep | Notifier; consumed by guardian; not validation |
| `.github/workflows/mobile-apk-manual.yml` | keep | Manual APK artifact build; not validation |
| `.github/workflows/ega-weekly-reviews.yml` | keep | Operational cron (fix separately; see §11 risk) |
| `.github/workflows/pr2-workspace-validation.yml` | **disable in PR9 → delete in PR10** | Branch-pinned; superseded (§6) |
| `.github/workflows/pr2-workspace-lock-refresh.yml` | **disable in PR9 → delete in PR10** | Branch-pinned maintenance; regeneration becomes a documented local act (§6.3) |
| `.github/workflows/pr3-contracts-domain-validation.yml` | **disable in PR9 → delete in PR10** | Superseded (§6) |
| `.github/workflows/pr4-project-goal-application-validation.yml` | **disable in PR9 → delete in PR10** | Superseded (§6) |
| `.github/workflows/architecture-stack-validation.yml` | **disable in PR9 → delete in PR10** | Live-red today (lint debt); fully superseded (§6.4) |
| `.github/workflows/mcp-integration-ci.yml` | **delete in PR10** | Folded into unified `mcp` path scope (§6.5) |
| `.github/workflows/public-signup-ci.yml` | **delete in PR10** | Folded into unified `web` job + signup path scope (§6.6) |
| `.github/workflows/sonarcloud.yml.disabled` | **delete in PR10** | Dead disabled artifact (evidence: disabled state + no sonar config/token use) |
| `.github/workflows/ega-daily-emails.yml.disabled`, `ega-task-reminders.yml.disabled` | keep (or PR10 delete with owner sign-off) | Disabled operational crons; **not** validation; out of PR9 scope |

New supporting files (PR9 implementation, design contract only):
- `scripts/ci/workspace-proofs.mjs` — generalized lockfile-authority + framework-pin + manifest-edge proofs (from pr2/pr3/pr4 inline node scripts; parameterized by package list so PR5/PR6/PR7 add to it).
- `scripts/ci/package-purity.mjs` — contracts/domain/application/data-access purity scans + compat-file duplicate-authority proof (from pr3/pr4).
- `scripts/ci/security-proofs.mjs` — actor-identity + repository-trust proofs (from pr4).
- `scripts/ci/lint-baseline.json` + `scripts/ci/lint-regression.mjs` — lint baseline capture and changed-path regression gate (§8).
- Root script additions: `ci:workspace`, `ci:purity`, `ci:security`, `lint:changed`, `lint:report`; and the naming contract for future stages: **PR5 MUST add `server:typecheck|test|build`; PR6 MUST add `api-client:typecheck|test|build`; PR7 MUST add `web:typecheck|test|build` (or rewire root `typecheck/test/build`)** — the unified workflow references these names, so the contract must be honored or the workflow updated in the same PR that breaks it.

### 4.2 `unified-platform-validation.yml` specification

**Triggers:**
```yaml
on:
  pull_request:
    branches: [main, "arch/**"]
  push:
    branches: [main, "arch/**"]
  workflow_dispatch:
concurrency:
  group: unified-ci-${{ github.ref }}
  cancel-in-progress: true
permissions:
  contents: read
```

**Env (build placeholders, per existing pattern):** `DATABASE_URL=postgresql://postgres:***@127.0.0.1:5432/postgres`, `MCP_ENABLED=false`, `MCP_WRITES_ENABLED=false`, `NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_ci_placeholder`, `NEXT_PUBLIC_SITE_URL=https://example.com`.

**Job layout** (13 jobs; each: `checkout@v5` + `setup-node@v6` Node 22 with npm cache on `package-lock.json` + `npm ci --no-audit --no-fund`; all in parallel except `hygiene` which `needs` all):

```
changes (paths-filter) ──► gates leaf jobs
   │
   ├─► workspace      (always)   proofs + purity + security + boundaries + fixtures + audit
   ├─► contracts      (always)   typecheck + test
   ├─► domain         (always)   typecheck + test
   ├─► application    (always)   typecheck + test
   ├─► data-access    (always)   typecheck + test
   ├─► regressions    (always)   agent-context + runner typecheck + runner PR-loop
   ├─► lint-changed   (always)   scoped eslint on changed paths vs baseline (§8)
   ├─► lint-report    (always, continue-on-error)  full-repo lint → summary + drift
   ├─► web            (if web scope)   typecheck + test + production build (root pre-PR7; apps/web post-PR7)
   ├─► mobile         (if mobile scope) doctor + typecheck + test + android bundle
   ├─► server         (if server scope AND apps/server exists)  typecheck + test + build
   ├─► api-client     (if api-client scope AND packages/api-client exists)  typecheck + test + build
   └─► hygiene        (needs all, always())  diff hygiene + generated-artifact proofs + mutation report
```

**`changes` job** — `dorny/paths-filter@v3`:
```yaml
filters:
  mobile:      ['apps/mobile/**', 'packages/contracts/**', 'packages/domain/**',
                'package.json', 'package-lock.json', '.github/workflows/**']
  server:      ['apps/server/**', 'packages/contracts/**', 'packages/domain/**',
                'packages/application/**', 'packages/data-access/**',
                'package.json', 'package-lock.json', '.github/workflows/**']
  api-client:  ['packages/api-client/**', 'packages/contracts/**',
                'package.json', 'package-lock.json', '.github/workflows/**']
  web:         ['apps/web/**', 'src/**', 'drizzle/**', 'drizzle.config.ts',
                'packages/**', 'apps/server/**',
                'package.json', 'package-lock.json', '.github/workflows/**']
```
Leaf jobs `if: needs.changes.outputs.<scope> == 'true'` (mobile/server/api-client additionally guard on target existence). **Push-event behavior:** paths-filter compares against the default branch (`main`) on pushes, which resolves conservatively to a full matrix on `arch/**` pushes — the same cost the per-stage workflows already paid, and the safe choice during the stack era. On PRs, scoping engages. If a filter ever under-matches (e.g., a new root-level dependency), the `package.json`/`package-lock.json`/`.github/workflows/**` entries in every filter force the full matrix.

**Job contents (step-level contract):**

| Job | Steps (order matters) |
|---|---|
| `workspace` | 1) diff hygiene pre-install (`git diff --check` vs base; `test -z "$(git status --porcelain)"`) — base = `github.event.pull_request.base.sha` for PRs, `HEAD~1` for pushes; 2) `npm ci`; 3) `scripts/ci/workspace-proofs.mjs` (root lock authority, no nested locks, framework pins, workspace identities, manifest↔lock edges — parameterized for all current + future workspaces); 4) `npm ls react react-dom react-native expo-router` single-version checks; 5) `npm audit --omit=dev --audit-level=high` (today only in mcp workflow — **gap closed**); 6) `scripts/ci/package-purity.mjs`; 7) `scripts/ci/security-proofs.mjs`; 8) `npm run check:architecture`; 9) `npm run test:architecture` |
| `contracts` / `domain` / `application` / `data-access` | `<pkg>:typecheck` then `<pkg>:test` |
| `regressions` | `validate:agent-context`; `typecheck:ega-runner`; `test:ega-runner-pr-loop` |
| `lint-changed` | `scripts/ci/lint-regression.mjs` — eslint on changed files (PR: `base.sha..head`; push: vs `main`), per-file counts compared to `scripts/ci/lint-baseline.json`; **fails only if a changed file exceeds its baseline**; emits summary table |
| `lint-report` | `npm run lint` with `continue-on-error: true`; writes totals to step summary; **fails the job if totals exceed baseline +1 warning drift** (drift detector) — never fails on the baseline itself |
| `web` | root `npm run typecheck`, `npm test`, `npm run build` (pre-PR7) → `web:typecheck`, `web:test`, `web:build` (post-PR7) |
| `mobile` | `mobile:doctor`, `mobile:typecheck`, `mobile:test`, `mobile:bundle` (bundle keeps the diagnostic-capture pattern from pr2) |
| `server` | `server:typecheck`, `server:test`, `server:build` (existence-guarded; PR5 contract) |
| `api-client` | `api-client:typecheck`, `api-client:test`, `api-client:build` (existence-guarded; PR6 contract) |
| `hygiene` | `needs: [workspace, contracts, domain, application, data-access, regressions, lint-changed, lint-report, web, mobile, server, api-client]`, `if: always()`: 1) `git diff --check` again; 2) generated-artifact proofs: `test -z "$(git ls-files 'apps/mobile/android/**' 'apps/mobile/ios/**' 'apps/mobile/.expo/**' 'apps/mobile/artifacts/**' '.next/**' 'apps/web/.next/**' 'apps/server/dist/**' 'packages/api-client/dist/**')"`; 3) `git status --short` mutation report (informational, mirrors existing pattern) |

Timeout: 45 min per job. Check names are stable job names (`unified / workspace`, …) so branch protection + Slack notifier + guardian read them unambiguously.

---

## 5. Coverage matrix (every required validation → where it runs)

| Required validation | Unified job/step | Source today | Gap? |
|---|---|---|---|
| npm workspace integrity (single root lock, nested-lock ban, identities, edges) | `workspace` step 3 (`workspace-proofs.mjs`) | pr2/pr3/pr4 inline proofs | no |
| Lockfile authority (`npm ci` clean from lock alone) | `workspace` step 2 | all workflows | no |
| Framework pins (Expo/RN/React/Next/Expo-Router/Babel-preset) | `workspace` step 3 | pr2 | no |
| Contracts purity | `workspace` step 6 + `check:architecture` (`contracts-platform-neutral`) + `contracts` job | pr3 + checker | no |
| Domain purity | same | pr3 + checker | no |
| Application purity | `workspace` step 6 + checker | pr4 | no |
| Data-access boundaries (no Next, app-only dep, no service role) | `workspace` step 6 + `check:architecture` + `security-proofs.mjs` | pr4 | no |
| Api-client neutrality | `check:architecture` (`api-client-platform-neutral`, activates PR6) | checker only (rule exists, package absent) | **PR6 + unified job** |
| Mobile boundaries | `check:architecture` (5 mobile rules) + `mobile` job | checker + pr2/3/4 | no |
| Server boundaries | `check:architecture` (`mobile-no-server` active; proposed `server-no-web/mobile` + `web-no-server`) + `server` job | checker anticipates | **PR5 + rule additions** |
| Web boundaries | `check:architecture` (web alias handling exists; proposed `web-no-server`, `web-no-api-client`) + `web` job | checker anticipates | **PR7 + rule additions** |
| Architecture fixtures | `workspace` step 9 (`test:architecture`) | pr2/3/4 + arch-stack | no |
| Application tests | `application` job | pr4 | no |
| Data-access tests | `data-access` job | pr4 | no |
| Contracts/domain tests | `contracts`/`domain` jobs | pr3 | no |
| Server tests | `server` job | **none today** | **YES — new** |
| Api-client tests | `api-client` job | **none today** | **YES — new** |
| Mobile tests + doctor + bundle | `mobile` job | pr2/3/4 + mobile-apk-manual | no |
| Root/web tests + typecheck | `web` job | pr2/3/4 + arch-stack + mcp/signup | no |
| Production builds (web, mobile bundle, server, api-client) | `web` build, `mobile` bundle, `server` build, `api-client` build | pr2/3/4 (web+mobile only) | **server/api-client builds — new** |
| Runner regression (typecheck + PR-loop) | `regressions` | pr2/3/4 + arch-stack | no |
| Agent-context regression | `regressions` | pr2/3/4 + arch-stack | no |
| Actor-identity security proof | `workspace` step 7 (`security-proofs.mjs`) | pr4 only | no (now permanent) |
| Repository trust / request-scoped client proof | `workspace` step 7 | pr4 only | no (now permanent) |
| Compat-file duplicate-authority proof | `workspace` step 6 | pr3 only | no (now permanent) |
| Dependency audit (prod, high+) | `workspace` step 5 | mcp only | **now always-on** |
| Diff hygiene (whitespace/porcelain) | `workspace` step 1 + `hygiene` | pr2/3/4 + arch-stack | no |
| Generated-artifact hygiene | `hygiene` step 2 | pr2/3/4 tail | **extend to server/web/api-client outputs** |
| Lint regression vs debt baseline | `lint-changed` + `lint-report` | **none (arch-stack lint is red noise)** | **YES — new mechanism** |
| MCP-path validation (scoped lint/tests) | covered by `web` job (`src/**` scope) + `lint-changed` + mcp tests in `npm test`; optionally a dedicated `mcp` path scope | mcp-integration-ci | folded |
| Signup/auth-path validation | `web` job + `lint-changed` scoped lint | public-signup-ci | folded |

---

## 6. Obsolete candidates — evidence requirements and removal plan

### 6.1 General evidence rule

PR10 may delete a workflow only when **all** of these hold, documented in the PR10 body with links:

1. **Merge evidence:** every branch the workflow's triggers reference is merged (or the trigger branches no longer exist). `git branch -r --merged origin/main` + `gh pr view <N> --json state,mergedAt` for each arch PR.
2. **Coverage evidence:** a mapping table (this doc §5) from every step of the old workflow to the unified job/step that now performs it, **plus** a green `unified-platform-validation.yml` run on the same head SHA the old workflow last validated (`gh run view <unified-run> --json headSha,conclusion`; compare SHAs).
3. **No-reference evidence:** `rg -l '<old-workflow-name>' . --glob '!node_modules'` returns nothing outside historical docs.
4. **Double-run evidence (for path-scoped folds):** for `mcp-integration-ci` and `public-signup-ci`, a recorded PR touching the relevant paths where the unified workflow produced the same pass/fail conclusions as the old workflow on the identical SHA (compare per-check outcomes, not just overall status).

### 6.2 Per-stage validators (`pr2-workspace-validation.yml`, `pr3-contracts-domain-validation.yml`, `pr4-project-goal-application-validation.yml`)

- **PR9:** rename to `*.disabled` **only after** the unified workflow is green on the same head (their triggers are branch-pinned, so they already stop firing once `arch/02..04` merge — disabling is belt-and-braces and prevents surprise re-runs during PR5–PR8 rework pushes to those branches).
- **PR10:** delete with §6.1 evidence (coverage mapping = §5 rows; the pr3/pr4 scope guards — "PR3 must not touch src/db" — are **not** migrated: they were one-shot stage constraints, superseded by boundary rules + review discipline).
- **Note:** the pinned `PR2/PR3/PR4_BASE_SHA` env vars become stale immediately after merge — a hygiene signal that the workflow is dead.

### 6.3 `pr2-workspace-lock-refresh.yml`

- **Not a validator — a mutating maintenance workflow** (`contents: write`, auto-commit+push). It must **never** be folded into unified CI (validators must be read-only; a workflow that writes to its own branch is a different animal).
- **PR9:** disable. **PR10:** delete. Evidence: (1) trigger branches merged; (2) unified `workspace` job proves lock↔manifest consistency on every run (npm ci + workspace-proofs), so an uncommitted lock cannot silently pass; (3) regeneration is a documented local act (`npm install --package-lock-only --ignore-scripts --no-audit --no-fund` — record this command in `docs/architecture/platform-monorepo.md` or a PR10 note; also captured in the monorepo-migration skill). Optional alternative if a manual regeneration button is wanted: convert to `workflow_dispatch`-only `lockfile-maintenance.yml` — **not recommended** (unattended auto-commit risk outweighs convenience post-migration).

### 6.4 `architecture-stack-validation.yml`

- **Live-red today** (lint debt: `✖ 92 problems (39 errors, 53 warnings)` on every arch push; both jobs fail at `Lint web root`). Its `pinned-main-baseline` job is obsolete once unified CI validates PRs-to-main and main pushes (which the per-stage workflows never did).
- **PR9:** disable (`.disabled`) **after** unified CI proves green on the same arch head — this immediately stops 2 failing check names per push. **PR10:** delete. Evidence: coverage mapping (§5: agent-context, runner, root typecheck/test/build, architecture, lint) + green unified run on the same SHA + the lint-baseline mechanism (§8) in place so the unified workflow does not inherit the red-lint failure mode.

### 6.5 `mcp-integration-ci.yml`

- Fold, don't duplicate: its audit step moves to `workspace` step 5 (always-on); its scoped mcp lint is covered by `lint-changed` (mcp files are in the diff when touched); mcp tests run inside `npm test` (web job, `src/**` scope); typecheck/build covered by `web`.
- **PR10:** delete with §6.1.4 double-run evidence (a PR touching `src/lib/mcp/**` where unified == old conclusions on the same SHA).

### 6.6 `public-signup-ci.yml`

- Same fold: focused tests are a subset of `npm test`; scoped lint via `lint-changed`; typecheck/build via `web`.
- **PR10:** delete with §6.1.4 double-run evidence. Optional interim: add `signup` path scope to unified if the focused 11-file test list is ever wanted as a fast-feedback job — not required, the full suite already covers it.

### 6.7 Disabled files

- `sonarcloud.yml.disabled`: **PR10 delete** (evidence: `.disabled` suffix = ignored for N releases; no sonar-scanner config in repo; `sonar:export-reliability` script is the only survivor and is harmless).
- `ega-daily-emails.yml.disabled` / `ega-task-reminders.yml.disabled`: operational crons, disabled intentionally; **keep** unless the owner confirms they are dead (then PR10 delete with a note). Out of PR9 scope.

### 6.8 Removal sequence (PR10, single cleanup PR)

1. Delete 4 per-stage validators + `architecture-stack-validation.yml` + `mcp-integration-ci.yml` + `public-signup-ci.yml` (+ optional sonarcloud/disabled crons).
2. Add the §6.1 evidence block to the PR body.
3. Confirm `unified-platform-validation.yml` is the only active validation workflow; confirm check names on a merged main SHA are all `unified / *`.
4. If branch protection is ever configured, its required checks list must reference only `unified / *` names.

---

## 7. Gaps the unified CI must add (nothing covers these today)

1. **Server CI (PR5 topology):** `apps/server` typecheck/test/build. No current workflow can validate it. The unified workflow's `server` job is existence-guarded and activates when `apps/server/` appears; PR5 must add `server:typecheck|test|build` root scripts.
2. **Api-client CI (PR6 topology):** `packages/api-client` typecheck/test/build + neutrality (rule exists). Same activation pattern; PR6 must add `api-client:typecheck|test|build`.
3. **Web workspace CI (PR7 topology):** after Next moves to `apps/web`, root `typecheck/test/build` no longer validates the web app. PR7 must add `web:typecheck|test|build` (or rewire root scripts) and unified's `web` job switches to them; generated-artifact hygiene extends to `apps/web/.next`.
4. **Always-on dependency audit:** `npm audit --omit=dev --audit-level=high` currently runs only in the MCP path-filtered workflow — most PRs never see it. Moves to `workspace` step 5.
5. **Lint regression detection with debt baseline:** first mechanism in the repo that distinguishes inherited debt (39E/53W) from new violations; also detects debt drift (observed: handoff baseline says 52 warnings, live run shows 53).
6. **Main-branch full validation:** today `main` gets only path-scoped mcp/signup checks + a red arch-stack workflow; a PR to `main` has no full-platform green gate. Unified CI's `pull_request: [main]` + `push: [main]` closes this.
7. **Security-proof permanence:** actor-identity + repository-trust + compat-authority proofs currently live only in branch-pinned temp workflows; they would die with the branches. Extraction to `scripts/ci/` makes them permanent (§4.1).
8. **Extended generated-artifact hygiene:** server/api-client build outputs (dist) join the untracked proofs.
9. **Boundary-rule additions** (design proposal, confirm with PR5/PR7 implementers): `web-no-server`, `web-no-api-client`, `server-no-web`, `server-no-mobile` (+ fixtures) so the checker — not only the doc — enforces the `platform-monorepo.md` dependency direction (§2.3).

---

## 8. Lint debt baseline mechanism

- **Capture:** at PR9 implementation start, run `npx eslint --format json .` (or `npm run lint -- --format json`) and write `scripts/ci/lint-baseline.json`: `{ capturedAt, sha, totals: { errors: 39, warnings: 53 }, perFile: { "<path>": { errors, warnings } } }`. The live capture takes precedence over the handoff numbers (handoff: 39/52; live run 2026-08-09: 39/53 — one warning drifted; the mechanism exists precisely to surface this).
- **Gate (`lint-changed` job):** eslint runs only on files changed in the PR (vs `base.sha`) or push (vs `main`). Pass = every changed file's error/warning count ≤ its baseline entry. New files (no baseline entry) must be **zero-problem** — that is the regression rule. Files not in the diff are untouched by the gate.
- **Report (`lint-report` job, `continue-on-error: true`):** full-repo lint always runs; totals compared to baseline; drift > +1 warnings or any new error beyond baseline → job reports failure (annotations + step summary) but does not block merge until PR10 readiness flips it to blocking.
- **Baseline updates:** only via deliberate PRs that also fix the counted problems (baseline never silently grows; a PR that fixes 10 errors lowers the baseline entry).
- **PR10 readiness:** when the baseline reaches 0/0 (or owner approves), `lint-report` flips to blocking and the baseline file can be retired; the `lint-changed` gate stays as the fast path.
- This design makes full-repo lint **informative, not blocking**, while making **changed-path lint effectively blocking** — the exact inversion of today's situation, where full lint blocks everything (red arch-stack) and nothing catches per-PR regressions.

---

## 9. Dependencies and sequencing

1. **PR9 must NOT finalize until PR8's topology exists.** The final-state unified workflow references `apps/web` (PR7/PR8), `apps/server` (PR5), `packages/api-client` (PR6). Two valid options, both acceptable — **recommended: A**:
   - **A (recommended): land early, grow with the stack.** PR9 merges the unified workflow + `scripts/ci/*` with existence-guarded jobs; it is green on the current head (root web + mobile + 4 packages). PR5/PR6/PR7 each add their root scripts + the unified workflow's `server`/`api-client`/`web` jobs activate automatically. Under this option PR9 can merge as soon as PR4 lands; **finalization** (declaring stage 9 complete) still requires the full topology validated by one green unified run on the post-PR8 head.
   - **B: land after PR8.** PR9 sits until the stack completes, then merges the complete workflow in one shot. Simpler review, but leaves main/arch without the unified gate during PR5–PR8 (the era when server/api-client/web CI gaps are widest).
   - Either way, the **definition of done for Stage 9**: `unified-platform-validation.yml` green on a head containing apps/web, apps/server, packages/api-client, apps/mobile + all 4 packages, with every §5 row exercised (no existence-guard skipped) and per-stage validators disabled.
2. **Root-script contract with PR5/PR6/PR7** (§4.1): `server:*`, `api-client:*`, `web:*` script names must exist before/with the topology that the unified jobs reference; breaking the contract = update the workflow in the same PR.
3. **`architecture-stack-validation.yml` stays active (red) until unified is green** on the same head — the disable swap must not create a validation vacuum on `arch/**` pushes (the swap window is one push: unified green on head X ⇒ disable old ⇒ next pushes validate via unified only).
4. **Runner note:** `scripts/ega-runner` remains a standalone tracked-lock project; unified CI must keep the runner regression scripts as-is and must not fold runner deps into the root lock (its `node_modules` is tracked deliberately).
5. **Inherited lint debt stays distinguished from regressions** (§8): the baseline is captured once at PR9 start; PR9's own diff (workflow files, scripts/ci/*, docs) must introduce **zero** new lint problems in touched `.mjs` files (eslint flat config covers them — verify during implementation).

---

## 10. Proposed root scripts and file additions (design contract; NOT applied)

```text
scripts/ci/workspace-proofs.mjs    # lockfile authority + pins + manifest↔lock edges (parameterized)
scripts/ci/package-purity.mjs      # purity scans + compat duplicate-authority proof
scripts/ci/security-proofs.mjs     # actor-identity + repository-trust proofs
scripts/ci/lint-baseline.json      # captured baseline (39 errors / 53 warnings, live-captured)
scripts/ci/lint-regression.mjs     # changed-path eslint vs baseline; drift report
```

Root `package.json` additions (PR9): `ci:workspace`, `ci:purity`, `ci:security`, `lint:changed`, `lint:report`. Conventions for later stages: `server:typecheck|test|build`, `api-client:typecheck|test|build`, `web:typecheck|test|build` (mirroring `contracts:*`/`application:*` naming; package test scripts stay `node --import tsx --test test/*.test.ts`, typecheck stays `tsc --noEmit -p tsconfig.json` per the monorepo-migration skill conventions).

---

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Lint gate would block everything (today's red arch-stack state) | §8 baseline mechanism: full lint non-blocking, changed-path lint blocking; `lint-report` fails only on drift |
| Path-filter false negatives (a change escapes leaf jobs) | `package.json`/`package-lock.json`/`.github/workflows/**` in every filter force full matrix; push events resolve conservatively (vs `main`) |
| Validation vacuum during swap window | §9.3: disable old workflows only after unified green on same head |
| PR5–PR8 land scripts that don't match the unified contract (`server:*` etc.) | §9.2 contract stated in this doc; PR9 includes the contract in the workflow file header comment; PR5/6/7 handoffs reference it |
| `hygiene` job double-checks `git status` after builds and reports noise (mobile bundle writes `.expo/ci-export`) | Mirrors existing pattern: untracked-but-ignored outputs are reported, not failed; only `git diff --check` and `git ls-files` proofs are blocking |
| Slack notifier/guardian sees new check names | Check names stable (`unified / <job>`); notifier logic is name-agnostic (counts all non-self checks); verify one merged main PR post-PR9 |
| `ega-weekly-reviews.yml` failing on schedule pollutes "CI health" perception | Out of scope for PR9; flag to owner; do not conflate with validation (it's an operational cron hitting a live endpoint) |
| Branch protection absent on main — nothing requires unified CI | Repo-admin action outside files: recommend adding required checks `unified / *` after PR9; until then the Slack notifier remains the merge guard |
| Lock-refresh workflow auto-commit pattern tempts reuse | §6.3: delete, never fold into unified (validators must be read-only); document local regeneration command |
| Per-file lint baseline goes stale as files move (PR7 moves `src/**` → `apps/web/src/**`) | PR7 must re-run baseline capture (`lint:report --capture`) and record the move in `lint-baseline.json` (paths are keys) |

---

## 12. Non-goals / out of scope

- No changes to `apps/mobile`, `src/**`, packages, or root `package.json` in this design phase (read-only discovery; PR9 implementation may add only `scripts/ci/*`, root script aliases, the workflow file, and this doc).
- No pnpm/Turborepo, no dependency upgrades, no schema moves (per `platform-monorepo.md` non-goals).
- No changes to `slack-pr-ready.yml`, `mobile-apk-manual.yml`, `ega-weekly-reviews.yml` behavior.
- No branch-protection configuration (admin action outside repo files; recommendation only).
- No fixing the inherited lint debt (that is PR10 readiness work); the baseline mechanism exists to make debt visible without blocking.
- No deployment/readiness claims (PR10).

---

## 13. Appendix — evidence artifacts captured during discovery

- Live red run: `Architecture Stack Validation` #`31311061829` (arch/04 push, 2026-08-09): both jobs fail at `Lint web root` → `✖ 92 problems (39 errors, 53 warnings)` (from `actions/jobs/93238850636/logs`).
- Green per-stage run: `PR4 Project Goal Application Core Validation` success on arch/04 push, 2026-08-09.
- `main` protection API: `required_status_checks` = null (no required checks).
- `origin/main` tip == `PINNED_PR1_MAIN_SHA` == `7b997c4`; `origin/main..HEAD` = 91 commits.
- Repo state: `apps/` = `mobile` only; `packages/` = `application, contracts, data-access, domain`; `scripts/ega-runner/package-lock.json` + `node_modules/**` tracked.
- Workflow file count: 13 (10 active incl. 1 red, 3 disabled).
