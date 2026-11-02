# CI/CD Performance Audit — EGA House

**Status:** Audit only. No workflow, script, application, or infrastructure change was made.
**Date:** 2026-11-02
**Repository:** `egawilldoit/Ega-House-Platform`
**Branch audited:** `origin/main` @ `45f668a2` (merge of PR #340)
**Audit worktree:** `<worktree>/docs/ci-performance-audit`, branched from `origin/main`
**Companion document:** [`optimization-plan.md`](optimization-plan.md)

---

## 1. Scope, method, and evidence limits

### 1.1 What was measured

| Source | What it gives | Sample |
|---|---|---|
| `gh run list` / Actions API | run list, attempt, concurrency, event, conclusion | 100 most recent `Unified Platform Validation` runs (2026-10-29 01:37 → 2026-11-01 21:06 UTC) |
| `/actions/runs/{id}/jobs` | per-job `started_at`/`completed_at`, per-step timings, runner name, conclusion | all 100 runs |
| Job logs (`gh run view --log`) | step internals, npm cache keys/hits/sizes, Vitest summary, Playwright download phases | runs `41349819428`, `41348572389`, `41335541779` |
| `/actions/runs/{id}/timing` | billable minutes | run `41349819428` |
| Branch protection API | required status-check contexts | `main` |
| Pull-request file lists | real change scope per PR (filter replay) | PRs #328–#340 |
| Local Vitest JSON report | per-test-file durations for shard balancing | 306 files on this revision |

### 1.2 Evidence limits (important)

1. **The workflow changed during the measurement window.** Commit `dee17084`
   ("ci: cut unprotected work and gate jobs by dependency", 2026-11-01 18:13:47Z)
   is the current architecture. **Five** successful runs use it:
   `41335539897` (dispatch, 18:14), `41335541779` (PR, created 18:14 but first job
   started 19:46), `41344085379`, `41348572389`, `41349819428`. They are part of
   the 100-run sample, not additional to it. The other 95 runs measure the
   preceding configuration; the `web` job step sequence is identical across both,
   so the web numbers remain comparable, while aggregate job counts and
   `lint-report`/`delivery-map` presence are **not**.
2. **The repository is public.** GitHub-hosted standard runners are free and
   unmetered for this repo (verified: `/timing` reports `total_ms: 0` for all 15
   jobs of run `41349819428`). "Runner minutes" below are therefore a
   **reliability/queue-pressure and portability metric, not a dollar cost**.
   This inverts several classic CI-cost optimizations — see §8.
3. **One queue outlier.** Run `41335541779` was created at 18:14 but its first job
   started at 19:46 (92 min). Cause not established from available evidence
   (runner capacity vs. GitHub-side scheduling); it is excluded from p50/p90.
4. No CI run was triggered for this audit and no workflow file was modified.

### 1.3 Worktree and base verification

```
pwd                      <worktree>
branch                   docs/ci-performance-audit  (created from origin/main)
base / HEAD              45f668a2  (origin/main, merge of PR #340)
pre-existing modification supabase/.temp/cli-latest  (untouched, excluded from commits)
```

No other worktree, branch, PR, or project directory was modified.

---

## 2. Current CI topology

### 2.1 Workflows present on `main`

| File | Trigger | Role | Runner |
|---|---|---|---|
| `unified-platform-validation.yml` (640 lines) | `pull_request` + `push` → `main`, `arch/**`, `wave/**`; `workflow_dispatch` (`force_full`) | the only required validation gate | `ubuntu-latest` ×15 jobs |
| `mobile-delivery.yml` (721 lines) | `workflow_dispatch`, `mobile-v*` tags | APK build + launch smoke + GitHub Release | `ubuntu-latest` preflight/smoke, `blacksmith-2vcpu-ubuntu-2404` Gradle build only (L171) |
| `mobile-ota.yml` | `workflow_dispatch` | EAS Update, production only | `ubuntu-latest` |
| `slack-pr-ready.yml` | `pull_request`, `check_suite`, `check_run`, `status` | Slack notification only, never merges | `ubuntu-latest` |
| `ega-weekly-reviews.yml` | cron + dispatch | product cron, **currently failing** (2 failures on 2026-11-02) | `ubuntu-latest` |
| `*-emails.yml.disabled`, `*-reminders.yml.disabled` | — | ignored by GitHub | — |
| CodeQL | GitHub **default setup** (dynamic, no repo file) | code scanning/quality | GitHub-managed |

No Electron, Rust, Gradle-in-PR, multi-OS matrix, or paid runner exists anywhere
in the PR path. `/actions/workflows` also lists deleted historical workflows;
they are not part of the current tree.

### 2.2 Job graph (current)

```
changes (dorny/paths-filter, 6–7 s)
   ├── workspace   (always)                      ~51 s p50
   ├── contracts   ┐
   ├── domain      │ packages == true            ~49 s each
   ├── application │
   ├── data-access ┘
   ├── api-client  (api-client == true)          ~47 s
   ├── server      (server == true)              ~61 s
   ├── web         (web == true)                 ~193 s p50 / 281–299 s current
   ├── mobile      (mobile == true)              ~99 s
   ├── db-invariants (db == true, postgres svc)  ~69 s
   ├── lint-changed  (code == true)              ~50 s
   ├── regressions   (regressions == true)       ~49 s
   └── lint-report   (force_full/dispatch only)  ~101 s, continue-on-error
        ↓
     hygiene (always, aggregate gate + diff hygiene + untracked-output proof)
```

Every leaf job depends only on `changes` — **there is no unnecessary serialization
between jobs today**. The serialization that costs wall clock is *inside* the
`web` job.

### 2.3 Required checks on `main`

`strict: true`, 15 required contexts (all from the unified workflow):

```
changes  workspace  contracts  domain  application  data-access  regressions
lint-changed  lint-report  web  mobile  server  api-client  db-invariants  hygiene
```

Two consequences shape the whole optimization space:

- **A skipped job satisfies its required context** (verified: PR #340 merged while
  10 of 15 jobs were `skipped`). Path filtering is therefore already load-bearing
  for merge safety.
- **`hygiene` is the single always-on aggregate.** It fails on any dependency that
  concluded `failure`/`cancelled`, and fails on `skipped` when `force_full=true`
  (`.github/workflows/unified-platform-validation.yml:582-640`). New jobs can
  therefore be made blocking **without touching branch protection**, as long as
  their names are added to `hygiene.needs` and its check list.

---

## 3. Baseline measurements

### 3.1 End-to-end (wall clock) and runner minutes

Sample: 100 runs, 2026-10-29 → 2026-11-01. Successful runs only for percentiles.

| Metric | p50 | p90 |
|---|---|---|
| End-to-end wall clock; **all** successful runs (n=34) | **281 s** | **331 s** |
| End-to-end wall clock; full-matrix scope (≥14 jobs) | 197–299 s | 331 s |
| Runner minutes per run (sum of job durations; n=34) | **13.7 min** | **18.2 min** |

Current-config runs, individually:

| Run | Event | Scope | Jobs run | End-to-end | Longest job | Runner min |
|---|---|---|---|---|---|---|
| `41349819428` | push `main` | merge of #340 (web-only) | 5 / 15 | **299 s** | `web` 281 s | 6.5 |
| `41348572389` | PR #340 | web-only (8 files) | 5 / 15 | **320 s** | `web` 299 s | 7.1 |
| `41344085379` | push `main` | mixed (14 jobs) | 14 / 15 | **197 s** | `web` 176 s | 14.6 |

### 3.2 Job durations (100-run sample; config-mixed)

| Job | Runs | p50 | p90 | max | Notes |
|---|---|---|---|---|---|

Rows other than the split `web` rows include failed/cancelled executions that stop
early, so they understate a completed run. The successful-only `web` figure (262 s
p50, n=49) is the correct input for the critical-path model.
| `web` (successful only) | 49 | **262 s** | **299 s** | 307 s | the throughput measure used below |
| `web` (all executions) | 86 | 193 s | 287 s | 307 s | includes aborted runs that stop early — not a throughput measure |
| `lint-report` | 86 | 101 s | 127 s | 138 s | legacy always-on; now force-full only |
| `application` | 88 | 57 s | 63 s | 67 s | 30–40 s of it is `npm ci` |
| `data-access` | 88 | 55 s | 61 s | 71 s | |
| `mobile` | 39 | 99 s | 130 s | 140 s | Expo doctor + typecheck + jest + export |
| `lint-changed` | 90 | 50 s | 61 s | 71 s | eslint itself is ~3 s |
| `workspace` | 90 | 51 s | 63 s | 187 s | always-on gate |
| `regressions` | 88 | 49 s | 55 s | 60 s | |
| `contracts` | 88 | 49 s | 54 s | 63 s | |
| `domain` | 88 | 49 s | 55 s | 60 s | |
| `server` | 47 | 61 s | 72 s | 79 s | |
| `api-client` | 39 | 47 s | 55 s | 56 s | |
| `db-invariants` | 39 | 69 s | 78 s | 105 s | 12 s container init + 15 proof steps |
| `changes` | 90 | 7 s | 8 s | 10 s | |
| `hygiene` | 90 | 7 s | 9 s | 9 s | |
| ~~`delivery-map`~~ | 85 | 44 s | 51 s | 60 s | removed by `dee17084`, folded into `workspace` |

### 3.3 The `web` job in detail (the bottleneck)

| Step | `41344085379` | `41349819428` | `41348572389` | share of current ~290 s |
|---|---|---|---|---|
| Checkout (exact head) | 1 s | 5 s | 2 s | ~1 % |
| `Set up Node 22` + cache restore (328 MB) | 6 s | 3 s | 6 s | ~2 % |
| `npm ci --no-audit --no-fund` | 24 s | **40 s** | **39 s** | **14 %** |
| `verify-platform-optionals.mjs` | 0 s | 0 s | 0 s | — |
| Web typecheck | 13 s | 22 s | 24 s | 8 % |
| Web font egress guard | 0 s | 0 s | 0 s | — |
| **Web tests (Vitest)** | 74 s | **121 s** | **125 s** | **43 %** |
| Web production build (`next build`) | 35 s | 51 s | 55 s | 18 % |
| Install Playwright Chromium (`--with-deps`) | 16 s | 26 s | 36 s | 9 % |
| Workspace shell browser contracts (2 tests) | 3 s | 6 s | 6 s | 2 % |
| **Total** | **176 s** | **281 s** | **299 s** | |

The four heavy steps run **strictly one after another** although only the last one
(browser contracts) requires the production build.

Note that `next build` itself re-runs TypeScript for **25.1 s** (run `41349819428`);
the standalone typecheck is a separate gate over the same tsconfig program, not a
way to remove that cost.

### 3.4 Where the web tests go

CI summary (run `41349819428`, `apps/web` Vitest):

```
Test Files  306 passed (306)
     Tests  2313 passed (2313)
  Duration  120.29 s  (transform 6.55 s, setup 0 ms, import 37.39 s,
                       tests 21.81 s, environment 22.36 s)
```

- Actual test assertions are only ~22 s. **~98 s is per-file module import,
  jsdom/environment construction and Vitest orchestration.**
- `vitest.config.ts` deliberately sets `fileParallelism: false` and
  `maxConcurrency: 1` (isolation over speed). Any parallelism change is a
  **behavioral** change; sharding across jobs is not.
- Local per-file duration report (306 files, this revision): total 55.9 s,
  p50 **26 ms**, p90 0.46 s, max **4.1 s**
  (`work-analytics-selected-range-integrity.test.ts`). Work is highly skewed:
  the 10 slowest files are ~40 % of the file time. A duration-weighted split
  (LPT) is perfectly even; Vitest's own `--shard` (round-robin over the sequencer
  order) is close because the distribution is dominated by a few files.
- Shard estimate: 2 shards ≈ 64 s, 3 shards ≈ 45 s, 4 shards ≈ 36 s of test time
  per shard, plus ~6 s Vitest startup each.

### 3.5 Playwright cost decomposition

From the run log (`41349819428`):

```
21:05:47  start
21:06:04  apt/system deps finished          (~17 s)
21:06:08  Chrome for Testing downloaded      (~4 s)
21:06:13  Chrome Headless Shell downloaded   (~3 s)
21:06:19  shell contracts passed             (2 tests, 6 s)
```

`playwright install --with-deps` is re-downloaded and re-apt-installed on every
run; nothing is cached. The browser download is only ~9 s of the 26–36 s step —
**most of the cost is the apt dependency installation**, which a browser-only
cache cannot remove.

### 3.6 Caching status (what works today)

- `actions/setup-node@v6` with `cache: npm` and `cache-dependency-path: package-lock.json`
  in **all 13 installing jobs**: primary-key **hit** observed, 328 MB restored in
  2–3 s (`Cache hit for: node-cache-Linux-x64-npm-01…`).
- Keys are version-specific by construction (lockfile hash + Node 22 + Linux x64).
- `npm ci` still takes **24–40 s after the cache hit**: the cache only supplies the
  package store; npm must still extract and link `node_modules`. Workspace packages
  are symlinks (`"link": true` in `package-lock.json`), and `.npmrc`
  `install-links=true` applies to `file:` dependencies, not to workspaces — neither
  explains the install cost.
- No cache exists for Playwright browsers, `node_modules`, `.next`, or `tsbuildinfo`.
- Cache writes are skipped on hit ("not saving cache"), so storage churn is low.

### 3.7 Queue time and tail

| Metric | p50 | p90 | max |
|---|---|---|---|
| Run created → first job started | **2 s** | **84 s** | 5,553 s (outlier `41335541779`) |
| Last job ended → run completed | 1 s | 1 s | — |

Queueing is normally negligible but has a heavy tail; 10 % of runs waited >84 s
for capacity. This matters when deciding *how many* parallel jobs to add (see
§8 and the plan's concurrency budget).

### 3.8 Cost of superseded and failing runs

| Class | Runs (of 100) | Runner minutes |
|---|---|---|
| `pull_request` success | 22 | 314 |
| `pull_request` failure | 33 | **415** |
| `pull_request` cancelled (superseded) | 32 | 239 |
| `push` success | 11 | 148 |
| `push` cancelled | **1** (`40821834402`, `main`) | 7 |
| `workflow_dispatch` success | 1 | 17 |

Cancellation works as intended for PRs (32 superseded runs stopped) but it also
cancelled **one `main` push**, which is the release-evidence SHA risk in item 8.

---

## 4. Critical path

Exact reconciliation for a web-only PR (run `41348572389`, end-to-end 320 s):

```
run created -> first job (web) starts         11 s
web job (API started_at -> completed_at)     299 s
  named steps: 2 checkout + 7 node/cache + 39 npm ci + 24 typecheck
             + 125 tests + 55 build + 36 playwright + 6 shell = 293 s
  unlisted: per-job setup/complete + step rounding = 6 s
wait after web ends before hygiene starts      2 s
hygiene                                        7 s
run completion tail                            1 s
                                              ----
                                              320 s
```

The 293 s step sum and the 299 s job duration are both correct; the difference is
GitHub per-job overhead, which any decomposition must add explicitly.

Model for a typical (p50) run, for forecasting only:

```
T = queue + npm_ci + typecheck + tests + build + playwright + shell + hygiene + tail
  = ~8 + 39 + 23 + 122 + 53 + 26 + 6 + 6 + 3   ~ 286 s
```

Observed end-to-end across the five current-config runs: 197, 285, 299, 320 s, plus
one run with a 92-minute scheduling gap.

The three independent operations — `typecheck`, `tests`, `build` — are the only
reorderable blocks, and they are currently chained. `build` must precede the
browser contracts (the Playwright `webServer` runs `next start` against `.next`).

**Runner-minute critical path is not the same as the wall-clock critical path.**
For a web PR the web job alone is 4.4–5.0 min of the 6.5–7.1 min total; the other
jobs exist mostly to pay for their own `npm ci`.

---

## 5. Scope segmentation (filter replay on real PRs)

Filters replayed from `.github/workflows/unified-platform-validation.yml:71-143`
against the actual changed-file lists of the 12 most recent PRs:

| PR | files | mobile | server | api-client | web | db | packages | code | regressions | Jobs run |
|---|---|---|---|---|---|---|---|---|---|---|
| #340 | 8 | . | . | . | Y | . | . | Y | . | 5 |
| #339 | 356 | Y | Y | Y | Y | Y | Y | Y | Y | 14 |
| #338 | 1 (`vercel.json`) | . | . | . | . | . | . | Y | . | 4 |
| #336 | 31 | Y | Y | Y | Y | Y | Y | Y | Y | 14 |
| #335 | 2 | . | . | . | Y | . | . | Y | . | 5 |
| #334 | 4 | . | Y | . | Y | . | Y | Y | . | 10 |
| #333 | 22 | . | . | . | Y | . | . | Y | . | 5 |
| #332 | 21 | Y | Y | Y | Y | Y | Y | Y | Y | 14 |
| #331 | 27 | . | Y | . | Y | . | Y | Y | . | 10 |
| #330 | 37 | Y | Y | Y | Y | Y | Y | Y | Y | 14 |
| #329 | 33 | Y | Y | Y | Y | Y | Y | Y | Y | 14 |
| #328 | 60 | Y | Y | Y | Y | Y | Y | Y | Y | 14 |

Observed distribution: **7 of 12 recent PRs are de-facto full matrix**, because
`packages/**` and `apps/server/**` fan out into `web`, `mobile`, `server`,
`api-client` and every package job. Filtering is real but has limited headroom on
this codebase — most agent PRs touch a package or the server.

### 5.1 Expected cost per scope (model, p50 step values)

| Scope | Jobs | Runner min | Wall clock | Basis |
|---|---|---|---|---|
| Docs-only (`docs/**` not agent-context) | 3 | 1.1 | ~80 s | model |
| Agent-context docs | 4 | 1.9 | ~130 s | model |
| Root `*.json` only (`vercel.json`) | 4 | 2.0 | ~115 s | model (PR #338) |
| Web-only | 5 | 5.1 | ~300 s | **measured** |
| Server/package | 10 | ~10.5 | ~210 s | model |
| Packages (full fan-out) | 14 | ~13.5 | ~210–300 s | **measured** |
| DB/schema (`drizzle/**`) | 6 | 6.3 | ~210 s | model |
| Main push (scope-dependent) | 5–15 | 6.5–14.6 | 197–299 s | **measured** |
| Forced full matrix | 15 | 16.7 | 285 s | **measured** |

---

## 6. Findings

### F1 — The `web` job is 89–94 % of the wall clock, and it serializes independent work

`typecheck` (23 s), `tests` (122 s) and `build` (53 s) are independent but chained.
Only `build → playwright → shell contracts` is a genuine dependency. This is the
single largest available win and it does not require changing any test semantics.

### F2 — Vitest is 43 % of the critical path and is single-file-serial

306 files / 2313 tests take 120 s, of which only ~22 s is assertions. The config
deliberately serialises files; two shards would remove tests from the critical path
entirely (64 s < 124 s build+E2E chain).

### F3 — `npm ci` is paid 13 times per run and is the second-largest aggregate cost

37–40 s per job after a confirmed cache hit. For a full-matrix run that is
**~7 of 14.6 runner minutes** spent installing the same dependencies. It does not
add wall clock when jobs are parallel, but it is the main lever inside any
consolidated/serialized job and the main vulnerability to queue pressure.

### F4 — Playwright setup is re-downloaded every run, and most of it is apt

26–36 s per web job: ~17 s apt/system deps + ~9 s browser download. A browser
cache alone recovers ~9 s; eliminating apt requires either proving the runner image
already satisfies Chromium or a container image. The claim "cache Playwright and
save 26 s" is **not supported** by the logs.

### F5 — Change detection is good, conservative, and already load-bearing

`dorny/paths-filter@v3`, GitHub-API based for PRs, 6–7 s, and it over-approximates
transitive consumers (safe direction). No replacement is warranted. Two real
coverage gaps exist: `vercel.json` matches only `code` (the deployment config is
never validated) and `.npmrc` matches nothing (install behaviour is exercised by
`workspace`'s `npm ci`, but no consumer test runs). Root `tsconfig.json` matching
only `code` is *not* a gap: it is unused by `apps/web`, and
`scripts/ega-runner/tsconfig.json` is standalone. None of this is a performance
issue.

### F6 — `cancel-in-progress` also cancels `main` runs

`concurrency.group: unified-ci-${{ github.ref }}` + `cancel-in-progress: true`
applies to `push: main`. One such run was cancelled (`40821834402`). The mobile
release gate only checks that *some* successful Unified run exists for a SHA
(`mobile-delivery.yml:151-170`), so a cancelled main run can leave a releasable SHA
without a completed gate until someone re-runs it.

### F7 — Release promotion does not require full-matrix evidence

`mobile-delivery` accepts **any** successful Unified run for the SHA. Because main
pushes are path-filtered, a green SHA may have run only 5 of 15 jobs. The
`release/full-matrix/*` mechanism and `force_full` exist precisely for this, but
the release gate does not require their output.

### F8 — Runner minutes are free on this repo; wall clock and concurrency are the real budgets

Billable minutes are `0` for all jobs. What is *not* unlimited: the free-plan
**20 concurrent jobs** per repo, and the observed queue tail (p90 84 s). The
current full matrix peaks at 14 concurrent jobs; CodeQL and the Slack notifier
share the same pool.

### F9 — The measurement base is thin for the current config

Only 3 completed runs under `dee17084`. Any post-change comparison must collect
≥10 runs before claiming a p50 improvement.

---

## 7. The 43-item assessment

Status vocabulary: `ALREADY IMPLEMENTED`, `IMPROVE`, `MISSING`, `NOT APPLICABLE`,
`UNSAFE`, `NEEDS EVIDENCE`.

Line references are to `.github/workflows/unified-platform-validation.yml` at
`45f668a2` unless another file is named. "Runner cost" is the aggregate
runner-minute delta (free on this public repo); "Wall clock" is the end-to-end
delta for the affected scope.

### 7.1 Smart execution (1–9)

| # | Item | Status | Current implementation & evidence | Wall clock | Runner cost | Risk / verification |
|---|---|---|---|---|---|---|
| 1 | Change detection | **ALREADY IMPLEMENTED** | `changes` job L39-145; `dorny/paths-filter@v3` L69-143; PR diff via GitHub API (log: "Fetching list of changed files for PR#340"); 6–7 s | — | — | Keep. Do not replace with a hand-rolled detector. |
| 2 | Dependency-aware filtering | **ALREADY IMPLEMENTED** (conservative) | L74-143 encode real consumer edges: `web` includes `packages/**` + `apps/server/**`; `server` includes application/data-access; `mobile` includes contracts/domain/api-client. Over-approximates, never under-approximates | — | — | Any narrowing must keep the explicit reverse-dependency closure and be tested against PR file lists (method in §5). |
| 3 | Conditional jobs | **ALREADY IMPLEMENTED** | every leaf: `if: needs.changes.outputs.X == 'true' \|\| needs.changes.outputs.force_full == 'true'` (L216, 238, 260, 282, 304, 330, 360, 383, 415, 443, 468, 493) | — | — | Guarded by `scripts/ci/unified-ci-force-full.test.mjs`. |
| 4 | Exact affected-package test filtering | **IMPROVE** (low) | any `packages/**` change runs contracts+domain+application+data-access+api-client+web+server+mobile (L74-143) | 0 (parallel) | up to ~4 min/run | No wall-clock gain; only matters if minutes become billable. Over-running is the safe direction. |
| 5 | Ignore irrelevant files | **ALREADY IMPLEMENTED** | `docs/**` matches no filter → 3-job run; `.github/workflows/**` deliberately matches everything (correct: CI changes must be validated) | — | — | Add `vercel.json`/`.npmrc` only if a real coverage gap is accepted as in-scope. |
| 6 | Skip platform-specific jobs | **NOT APPLICABLE** | single Linux target; no OS matrix anywhere; mobile Android build is tag/dispatch only (`mobile-delivery.yml`) | — | — | — |
| 7 | Early filtering for expensive test shards | **ALREADY IMPLEMENTED** | all leaves `needs: [changes]`; shards do not exist yet, so this is satisfied structurally | — | — | Preserve `needs: [changes]` on any new shard job. |
| 8 | Cancel superseded PR runs, keep main/release | **IMPROVE** | L23-25 unconditional `cancel-in-progress: true`; observed cancelled `main` run `40821834402` | 0 | 0 | Change to `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`. Verify: push twice to main → both runs complete; force-push a PR → old run cancels. |
| 9 | Release concurrency / duplicate builds | **ALREADY IMPLEMENTED** | `mobile-delivery.yml:10-12` group per ref, cancel-in-progress; `mobile-ota.yml:11-13` fixed group, **cancel-in-progress: false**; no scheduled builds; no matrix | — | — | A manual retry rebuilds the APK (intentional; no artifact promotion). |

### 7.2 Parallelism (10–19)

| # | Item | Status | Current implementation & evidence | Wall clock | Runner cost | Risk / verification |
|---|---|---|---|---|---|---|
| 10 | Independent concurrent jobs | **ALREADY IMPLEMENTED** | every leaf `needs: [changes]` only; measured job starts within +8–11 s of run creation | — | — | — |
| 11 | Dedicated web test jobs | **MISSING** | `web` L381-411 runs typecheck → tests → build → Playwright serially | **−155 s (~52 %)** | +2.5 min | Keep the job named `web` (required context) and add jobs gated by `hygiene`. Verify test count parity (306 files / 2313 tests). |
| 12 | Test-suite sharding | **MISSING** | no `--shard`, no matrix in the workflow | **−60 s** (2 shards) | +1.4 min/shard | `--shard` only selects files; `maxConcurrency: 1` inside each shard is unchanged. Verify shard file/test counts sum to the unsharded totals. |
| 13 | Duration-weighted shards | **MISSING** / **NEEDS EVIDENCE** | no per-file duration data in CI; local report: p50 26 ms, p90 0.46 s, max 4.1 s, 10 slowest ≈ 40 % of file time | included in #12 | — | Vitest round-robin over its sequencer order is near-LPT here. Measure shard durations over 5 runs; if imbalance >15 %, switch to an explicit file partition. |
| 14 | Parallel package tests | **ALREADY IMPLEMENTED** | 4 separate package jobs + api-client job, each 47–57 s of which 30–40 s is install | — | — | — |
| 15 | Remove unnecessary dependency ordering | **ALREADY IMPLEMENTED** | no job depends on another leaf; only `hygiene` aggregates | — | — | — |
| 16 | Parallel typecheck/build | **MISSING** | `Web typecheck` (L400), `Web tests` (L404), `Web production build` (L406) sequential | **−23 s** as a ceiling; folded into #11 | +0.9 min | Typecheck also runs inside `next build` (Next 16 type-checks by default) → defense in depth preserved. |
| 17 | Concurrent independent setup | **ALREADY IMPLEMENTED** | 13 jobs restore the same 328 MB npm cache concurrently in 2–6 s each | — | — | — |
| 18 | Parallel release packaging | **NOT APPLICABLE** | one APK, sequential preflight → build → smoke → publish by design (`docs/ci/mobile-delivery.md`) | — | — | — |
| 19 | Resource-aware concurrency | **IMPROVE** (low) | no `max-parallel`; ~13 concurrent jobs today (`workspace` + 12 leaves; `changes` finishes first); queue p90 84 s; `slack-pr-ready.yml` has no `concurrency` group and fires on every `check_run`/`check_suite`/`status` | 0 | ~0 | The Free-plan limit is **20 concurrent jobs per account**, not per repo (plan unverified here). Adding 3 web jobs -> ~16 concurrent, leaving little room for CodeQL or other repos. Measure scheduling delay after rollout; add `concurrency` to the Slack notifier separately. |

### 7.3 Caching (20–30)

| # | Item | Status | Current implementation & evidence | Wall clock | Runner cost | Risk / verification |
|---|---|---|---|---|---|---|
| 20 | Toolchain caching | **ALREADY IMPLEMENTED** | `actions/setup-node@v6` `cache: npm` in all installing jobs (L169-173 etc.); Node found in `hostedtoolcache` in 0.3 s | — | — | — |
| 21 | Version-specific keys | **ALREADY IMPLEMENTED** (caveat) | setup-node key = OS + arch + package manager + lockfile hash; the observed key `node-cache-Linux-x64-npm-01…` contains **no Node version**. Node is pinned to 22, so exposure is limited | — | — | If the Node major changes, the key does not — bump it deliberately. |
| 22 | npm package-store caching | **ALREADY IMPLEMENTED** | confirmed primary-key hit, 343,659,890 B restored | — | — | — |
| 23 | Filtered-install cache reuse | **ALREADY IMPLEMENTED** | one repo-wide store shared by every job; no per-filter caches to fragment it | — | — | — |
| 24 | Lockfile verification caching | **NOT APPLICABLE** | verification runs every time and costs 1–2 s (`npm run ci:workspace`); caching it adds risk for no measurable gain | — | — | Keep executing it; it is the proof, not a cacheable artifact. |
| 25 | Remote task-result caching | **NOT APPLICABLE** | no Nx/Turbo/Bazel; adding a paid remote cache is out of scope and unnecessary at 3 min | — | — | — |
| 26 | Per-test result caching | **NOT APPLICABLE** | Vitest has no safe result cache; a wrong hit would silently drop coverage | — | — | — |
| 27 | Electron caching | **NOT APPLICABLE** | no Electron; mobile is Expo/React Native; no desktop build | — | — | — |
| 28 | Playwright browser caching | **MISSING** | `playwright install --with-deps chromium` L409 every run; no cache step; ~9 s download + ~17 s apt | **−9 s** | 0 | Key on lockfile hash; keep `--with-deps` until a run proves the image already has the libs. Verify the 2 shell contracts still launch. |
| 29 | Conditional system deps | **IMPROVE** | `--with-deps` unconditional; apt is the majority of the step (log timestamps in §3.5) | **−15 s if** a dep-free image is proven | 0 | `UNSAFE` without an A/B run: a missing lib fails at browser launch. Stage as a measured experiment. |
| 30 | Cache-result verification | **ALREADY IMPLEMENTED** | hit/miss is logged per job; no cache-dependent correctness claim is made | — | — | Required if `node_modules` caching is attempted (see plan batch 2). |

### 7.4 Runner and checkout (31–35)

| # | Item | Status | Current implementation & evidence | Wall clock | Runner cost | Risk / verification |
|---|---|---|---|---|---|---|
| 31 | Blacksmith runners | **ALREADY IMPLEMENTED** (Gradle only, `mobile-delivery.yml:171`; policy in `docs/ci/mobile-delivery.md`) | keep unified CI on GitHub-hosted runners | — | — | Public repo: GitHub-hosted is $0/unmetered on 4 vCPU; a Blacksmith free tier is capped and 2 vCPU. ~3.2k unified runner-min/30 d would exceed a typical free cap. Only revisit with a measured A/B. |
| 32 | Runner right-sizing | **ALREADY IMPLEMENTED** | `ubuntu-latest` everywhere; no larger runners, no matrix, timeouts 45 min (10 min for aggregate jobs) | — | — | Timeouts are generous but never approached (max observed 307 s). |
| 33 | Sparse checkout | **MISSING** (low) | full checkout 1–5 s | ~1–2 s | 0 | `git diff --check`, delivery map and lint need the full tree. Not worth the breakage risk. |
| 34 | Minimal checkout for change detection | **IMPROVE** (low) | `changes` performs a full-history checkout (`fetch-depth: 0`) and uses the GitHub API for PR diffs; 6–7 s total | ~1–2 s | 0 | Not worth doing: push-mode base detection needs history and the step is already 2–3 s. |
| 35 | Avoid installing unrelated toolchains | **ALREADY IMPLEMENTED** | Node only; no Java/Python/Rust in the PR path; Android toolchain only in the tag/dispatch workflow | — | — | — |

### 7.5 Local development (36–39)

| # | Item | Status | Current implementation & evidence | Impact | Risk / verification |
|---|---|---|---|---|---|
| 36 | `check:changed`-equivalent | **MISSING** | `npm run lint:changed` exists (`scripts/ci/lint-regression.mjs`); no changed-path typecheck/test runner | dev-loop only | Low. Would save agent/dev round trips, which is where the real time is (25 runs/day). |
| 37 | Targeted test execution | **MISSING** | no `vitest related`/`--changed` script | dev-loop only | Low; must not replace required full-suite CI evidence. |
| 38 | Local successful-check caching | **NOT APPLICABLE** | no local cache infrastructure; CI is the source of truth | — | Would risk stale local "green" claims. |
| 39 | Incremental TypeScript | **MISSING** (low) | `apps/web/tsconfig.json` sets `incremental: true`, but CI runs `tsc --noEmit` with no persisted `tsbuildinfo` and the project has no references → no cross-run reuse | ~0 | Caching `tsbuildinfo` keyed by source hash almost never hits on a PR. Not worth it. |

### 7.6 Release (40–43)

| # | Item | Status | Current implementation & evidence | Impact | Risk / verification |
|---|---|---|---|---|---|
| 40 | Shared build-artifact reuse | **MISSING** | build output is consumed in-process; nothing uploaded; Vercel builds independently | optional −30 s, complexity +1 artifact | Only worth it if build and browser tests are split into separate jobs. `.next` upload/download ≈ 15–25 s each, so net gain is small. |
| 41 | Promotion of validated commits | **IMPROVE** | `mobile-delivery.yml:151-170` accepts **any** successful Unified run for the SHA; main pushes are path-filtered (§5) | 0 | **Protection gap, not a speed item.** Recommend requiring a completed `force_full` run for the release SHA (or recording the executed-job set in the gate). |
| 42 | Release dependency filtering | **ALREADY IMPLEMENTED** | mobile build only on `mobile-v*` tags or dispatch; PRs never build APKs | — | — |
| 43 | Conditional scheduled release | **NOT APPLICABLE** | no scheduled release exists; `ega-weekly-reviews` is a product cron (currently failing, unrelated to CI speed) | — | — | — |

### 7.7 Summary counts

Primary status is one per item, so the four rows below sum to 43. Secondary tags
(`NEEDS EVIDENCE`, `UNSAFE`) annotate items that already have a primary status and
must not be added to the total.

| Status | Items |
|---|---|
| ALREADY IMPLEMENTED | 1, 2, 3, 5, 7, 9, 10, 14, 15, 17, 20, 21, 22, 23, 30, 31 (Gradle only), 32, 35, 42 -> **19** |
| IMPROVE | 4 (low), 8, 19 (low), 29, 34 (low, not recommended), 41 -> **6** |
| MISSING | 11, 12, 13, 16, 28, 33 (low, not recommended), 36, 37, 39 (low), 40 -> **10** |
| NOT APPLICABLE | 6, 18, 24, 25, 26, 27, 38, 43 -> **8** |

Secondary annotations: `NEEDS EVIDENCE` for 13 and 29; `UNSAFE` for 29 without an
A/B run; `PARTIAL` for 31 (Gradle only).

---

## 8. What this means (and what not to do)

1. **Optimize the critical path before adding runners.** The repo is public;
   runners are free but capped at 20 concurrent jobs. Adding runners to a
   serialized job buys capacity, not speed.
2. **Do not migrate unified CI to Blacksmith.** It would convert $0/unmetered
   minutes into a capped free tier, on 2 vCPU instead of 4, for a workload of
   ~3.2k runner-minutes/month. Keep Blacksmith where it already is (Gradle, where
   the cache is genuinely colocated and the job is genuinely expensive).
3. **Do not replace `dorny/paths-filter`.** It is correct, conservative, and 7 s.
   The only filter gap worth recording is `vercel.json` (no validation at all),
   which is not a speed problem.
4. **Do not turn on `fileParallelism`.** The config comment and the isolation
   design are deliberate; sharding is the safe way to parallelise.
5. **Do not weaken `hygiene` or `force_full`.** They are the reason conditional
   jobs can be required checks.
6. **Do treat F6 and F7 as real defects.** They are cheap to fix and they protect
   the release gate that all this validation exists to serve.

---

## 9. Measurement plan for the follow-up

Before/after claims must be reported as observed, not projected:

| Claim to verify | Method | Threshold to accept |
|---|---|---|
| Web PR wall clock | ≥10 web-scope runs before and after; p50/p90 of `updatedAt−createdAt` | p50 −40 % or better |
| Test coverage parity | sum of shard "Test Files/Tests" must equal unsharded totals (306/2313 at `45f668a2`) | exact equality |
| Playwright cache usefulness | step duration before/after; browser cache hit logged | ≥6 s saved, contracts still pass |
| Typecheck coverage retained | deliberately break a type in a branch; `web-typecheck` must fail | new job red, `hygiene` red |
| Main-run preservation | two consecutive pushes to main | both runs complete |
| Queue impact | time-to-first-job p90 over 20 runs | no regression beyond +30 s |
| Free-tier concurrency | max concurrent jobs observed | ≤18 of 20 |

---

## 10. Corrections after independent review (2026-11-02)

An independent reviewer re-derived the numbers from the raw API and re-read the
workflow. The following statements in the first draft were wrong; the body above is
corrected, and the reasoning is recorded here so the history is auditable.

| # | Original claim | Corrected | Evidence |
|---|---|---|---|
| 1 | 3 current-config runs | **5** successful runs under `dee17084`, inside the 100-run sample rather than additional to it | commit time 18:13:47Z; runs `41335539897`, `41335541779`, `41344085379`, `41348572389`, `41349819428`; the 18:14 runs have no retired `delivery-map` job |
| 2 | `web` p50 193 s | 193 s is the **all-executions** median; successful web jobs are **262 s p50 / 299 s p90 (n=49)** | jobs API: 86 non-skipped web jobs, 49 successful |
| 3 | "web is 95 % of wall clock" | **89–94 %** (281/299, 299/320, 176/197) | run arithmetic |
| 4 | Critical-path decomposition "= 320 s" from 314 s of listed steps | named web steps sum to **293 s**, the job is **299 s**, and the missing 6 s is per-job overhead; full reconciliation 11+299+2+7+1 = 320 s | jobs + steps API |
| 5 | Vitest `4.0.7` | installed and locked **4.1.5** (`package.json` range `^4.0.7`) | `node_modules/vitest/package.json`; `package-lock.json:20322` |
| 6 | Sharding is "round-robin over the sequencer order, near-LPT" | Vitest SHA-1 hashes each test path, sorts by hash and slices by **count** — a size-agnostic partition that is not duration-balanced | `node_modules/vitest/dist/chunks/coverage.DM_a_rWm.js:35-47` |
| 7 | `.npmrc install-links=true` materialises workspace packages as copies | workspaces are **symlinks** (`"link": true`); `install-links` concerns `file:` dependencies | `package-lock.json:1698-1701`; `ls -l node_modules/@ega/*` |
| 8 | setup-node key includes the Node version | key is OS + arch + package manager + dependency hash; **no Node version** | observed key `node-cache-Linux-x64-npm-01…` |
| 9 | Free-plan limit is "20 concurrent jobs per repo" | it is **per account** (plan not verified); today's graph is ~13 concurrent, not 14 executed | workflow graph + GitHub plan limits |
| 10 | Root `tsconfig.json` is a coverage gap | **not a gap**: unused by `apps/web`; `scripts/ega-runner/tsconfig.json` is standalone | both tsconfig files |
| 11 | "`next build` type-checks by default" used as a coverage backstop | true, and measurable: **25.1 s** of the build is TypeScript (run `41349819428`) | build log |

Two reviewer assertions were **not** supported and are rejected:

- "Root `tsconfig.json` affects Runner typechecking, yet does not select `regressions`."
  `scripts/ega-runner/tsconfig.json` does not extend the root config, so a root
  tsconfig change cannot affect that job.
- "`total_ms: 0` is insufficient evidence for zero billing." It is insufficient for
  zero *physical* consumption (the run used 6.5 runner-minutes), which this document
  never claimed. For a public repository the billable amount is $0, and GitHub's
  billing documentation is the authority. Wording tightened to "billable minutes = 0;
  capacity is still consumed".

---

## 11. Implementation results (2026-11-02)

The plan was implemented in PR #341 (`docs/ci-performance-audit`) as five commits:

| Batch | Commit | Scope |
|---|---|---|
| 0A | `f2a39eb7` | strict aggregate gate (`scripts/ci/aggregate-gate.mjs`), workflow guardrail tests run in `workspace` |
| 0B | `ee802276` | release evidence bound to one run+attempt (`scripts/ci/release-evidence.mjs`), APK + OTA |
| 0C | `c095a5ca` | per-PR cancellation with per-run protection for main/dispatch/full-matrix; `.npmrc` routing |
| 1 | `f28f0516` | `web` = build + Playwright + shell; new `web-typecheck`; `web-tests` 2 shards |
| docs | this commit | results and Batch 2 decisions |

### Measured effect (matched full-matrix scope, same branch)

| Metric | Baseline `c095a5ca` | Implemented `f28f0516` |
|---|---|---|
| End-to-end | **346 s** | **141 s** (−59 %) |
| Critical job | `web` 302 s | `web-tests (1)` 106 s |
| Web concern runner minutes | 5.0 | 6.2 |
| Whole-run runner minutes | 17.85 | 16.68 |
| Required checks | 15/15 | 15/15 |
| Test parity | 306 files / 2313 tests | 306 files / 2313 tests (153+153; 1099+1214) |

Batch 1 composition (measured): `web` 92 s (24 npm ci + 35 build + 17 Playwright + 4
shell), `web-typecheck` 74 s (38 npm ci + 24 tsc), shards 106 s / 101 s (33–36 npm ci
+ 55–62 tests), `hygiene` 10 s.

The forecast in §9 of the plan (central 165 s) was conservative on two counts: the
build ran in 35 s rather than 51 s, and the shards were better balanced in CI (62 s vs
55 s) than the local split suggested. The 43-item statuses that changed since the
audit-time assessment: 8 (cancel superseded runs) → implemented, 11/12/16 (web test
jobs, sharding, parallel typecheck) → implemented. Item 28 (Playwright cache) is
rejected on evidence: the `web` job is no longer the critical path, and only the
~9 s download half is cacheable.

### Remaining evidence gaps

- n=1 matched before/after run. The structural change is unambiguous; a 10-run p50 is
  still pending and is collected from normal PR activity rather than manufactured runs.
- Live double-push verification of the concurrency policy has not been performed.
- The release gate's shard names were verified against the live API (`web-tests (1)`,
  `web-tests (2)`), but no release workflow has been executed with the new contract.
