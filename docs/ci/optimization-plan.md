# CI/CD Optimization Plan — EGA House

**Status:** Proposal. Nothing in this document has been implemented, pushed, merged,
or deployed. Implementation waits for owner approval.
**Date:** 2026-11-02
**Base:** `origin/main` @ `45f668a2`
**Evidence:** [`performance-audit.md`](performance-audit.md) (measured, 100 runs + 3 current-config runs)
**Scope constraint:** GitHub Actions and Blacksmith free tiers only. No paid runner,
no paid cache, no new platform.

---

## 1. Design constraints (non-negotiable)

| Constraint | Consequence for this plan |
|---|---|
| Repository is **public**: GitHub-hosted standard runners are free and unmetered | Optimize **wall clock and concurrency**, not minutes. Do not trade wall clock for minutes unless the minute cost is tiny. |
| 15 required status contexts on `main`, `strict: true` | The names `web`, `workspace`, `hygiene`, … must keep reporting. Never delete or rename a required job. |
| `hygiene` is the always-on aggregate and already required | New blocking work is attached through `hygiene.needs`, so **branch protection needs no edit**. |
| `force_full` (dispatch input + `release/full-matrix/*` PRs) must keep proving the full matrix | Every new job must OR in `force_full` and be listed in `hygiene`'s force-full skip check. |
| Existing change detector is correct and conservative | Do not replace `dorny/paths-filter`. No filter change in batch 1. |
| Required gates: security/dependency (`workspace`), database proofs (`db-invariants`), browser/E2E, production build, typecheck, lint regression, architecture | None may be skipped, merged, or made non-blocking. |
| `docs/ci/mobile-delivery.md` runner policy: no larger runners, no matrices for release builds, no Sticky Disks | Blacksmith stays Gradle-only. |
| Free plan: 20 concurrent jobs per repo, shared with CodeQL and the Slack notifier | Full matrix peaks at 14 today. Batch 1 raises it to ~17. Do not add more parallelism than needed. |

**Explicit non-goals:** replacing the change detector, enabling Vitest
`fileParallelism`, adding Nx/Turbo/remote cache, migrating to Blacksmith,
sparse checkout, test-result caching, Electron/Rust tooling.

---

## 2. Target architecture

Split the single `web` job into three independent jobs while **keeping the
required `web` context alive**, and shard the Vitest suite across two jobs.

```
changes ──┬── workspace            (unchanged, always)
          ├── contracts/domain/application/data-access/api-client/server/mobile
          ├── db-invariants        (unchanged)
          ├── lint-changed         (unchanged)
          ├── regressions          (unchanged)
          ├── lint-report          (unchanged, force-full only)
          │
          ├── web              [REQUIRED, unchanged name]  install → build → Playwright → shell contracts
          ├── web-typecheck    [new, gated by hygiene]     install → tsc --noEmit → font egress
          └── web-tests (1/2)  [new, gated by hygiene]     install → vitest --shard=N/2
              web-tests (2/2)
                    ↓
                 hygiene          (needs: all of the above)
```

Why this shape rather than a straight rename:

- `web` is a required context. Renaming or removing it would leave PRs waiting for
  a check that never arrives.
- `web` keeps the only genuinely ordered chain (`build → next start → browser
  contracts`), so no build-artifact sharing is required in batch 1.
- The two new concerns become blocking through `hygiene`, which is already
  required, so **no branch-protection change is needed**.
- `web-typecheck` / `web-tests` use the *same* `if:` expression as `web`, so the
  set of paths that trigger them is identical — no new filtering logic.

### 2.1 Proposed batch-1 job definitions (not applied)

```yaml
  web:
    needs: [changes]
    if: needs.changes.outputs.web == 'true' || needs.changes.outputs.force_full == 'true'
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - name: Checkout exact head
        uses: actions/checkout@v5
        with:
          ref: ${{ github.event.pull_request.head.sha || github.sha }}
      - name: Set up Node 22
        uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: package-lock.json
      - run: npm ci --no-audit --no-fund
      - if: runner.os == 'Linux'
        run: node scripts/ci/verify-platform-optionals.mjs
      - name: Web production build
        run: npm run build
      - name: Install Playwright Chromium
        run: npm exec --workspace @ega/web -- playwright install --with-deps chromium
      - name: Workspace shell browser contracts
        run: npm run test:visual --workspace @ega/web -- --grep "workspace shell contract"

  web-typecheck:
    needs: [changes]
    if: needs.changes.outputs.web == 'true' || needs.changes.outputs.force_full == 'true'
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - name: Checkout exact head
        uses: actions/checkout@v5
        with:
          ref: ${{ github.event.pull_request.head.sha || github.sha }}
      - name: Set up Node 22
        uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: package-lock.json
      - run: npm ci --no-audit --no-fund
      - if: runner.os == 'Linux'
        run: node scripts/ci/verify-platform-optionals.mjs
      - name: Web typecheck
        run: npm run typecheck
      - name: Web font egress guard
        run: npm run check:font-egress

  web-tests:
    needs: [changes]
    if: needs.changes.outputs.web == 'true' || needs.changes.outputs.force_full == 'true'
    runs-on: ubuntu-latest
    timeout-minutes: 45
    strategy:
      fail-fast: false
      matrix:
        shard: [1, 2]
    steps:
      - name: Checkout exact head
        uses: actions/checkout@v5
        with:
          ref: ${{ github.event.pull_request.head.sha || github.sha }}
      - name: Set up Node 22
        uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: package-lock.json
      - run: npm ci --no-audit --no-fund
      - if: runner.os == 'Linux'
        run: node scripts/ci/verify-platform-optionals.mjs
      - name: Web tests (shard ${{ matrix.shard }}/2)
        run: npm run test --workspace @ega/web -- --shard=${{ matrix.shard }}/2
```

Two implementation gotchas:

- Use the `--workspace … -- --flag` form above. `npm test -- --shard=…` would be
  swallowed by the outer `npm run` and silently run the unsharded suite.
- Sharding requires Vitest ≥ 3; this repo is on `vitest@4.0.7` (root lockfile).

and in `hygiene`:

```yaml
    needs: [changes, workspace, contracts, domain, application, data-access,
            regressions, lint-changed, lint-report, web, web-typecheck,
            web-tests, mobile, server, api-client, db-invariants]
```

plus `check web-typecheck "${{ needs.web-typecheck.result }}"`,
`check web-tests "${{ needs.web-tests.result }}"`, and the two new entries in
`scripts/ci/unified-ci-force-full.test.mjs` (`every path-filtered leaf job ORs in
force_full`, hygiene dependency list).

**Risk to check before merging:** with a matrix, the job id is `web-tests` and the
reported check names are `web-tests (1)` and `web-tests (2)`.
`needs.web-tests.result` aggregates the matrix correctly. None of these names is a
required context, so no branch-protection edit is needed.

---

## 3. Ranked optimization batches

Effort is engineering time in this repo; risk is regression risk to merge safety.

### Batch 1 — Split the web job (recommended first, highest payoff)

| | |
|---|---|
| Items | 11, 12, 16 (and 7/10/15 preserved) |
| Changes | only `.github/workflows/unified-platform-validation.yml` + `scripts/ci/unified-ci-force-full.test.mjs` |
| Critical path | `134 s` (`web`: install 39 + build 53 + Playwright 26 + shell 6 + checkout/setup 10) vs `281 s` |
| End-to-end | **~155 s** vs **281 s p50** (**−45 %**; −48 % vs the 299 s observed PR run) |
| Runner minutes | 6.6 → 8.7 min per web PR (+2.1 min, **$0** on a public repo) |
| Peak concurrency | 14 → 17 of 20 |
| Risk | Medium-low, bounded by the parity checks below |
| Rollback | revert one commit; `web` still contains build + E2E, so the fallback is the current pipeline |

Expected full-matrix effect: 285–299 s → ~155 s (−47 %), because `mobile` (99 s),
`lint-report` (101 s) and `workspace` (51 s) all remain below the new critical path.

### Batch 2 — Caching the two largest repeated costs (measure, then adopt)

| | |
|---|---|
| Items | 28 (Playwright browser cache), 29 (conditional system deps), plus a `node_modules` cache experiment for 20/23 |
| Measured basis | Playwright 26–36 s = ~17 s apt + ~9 s download; `npm ci` 37–40 s after a confirmed store-cache hit |
| Expected | web job 134 → ~102 s; typecheck 62 → 38 s; each shard 106 → 82 s ⇒ end-to-end **~120 s (−57 %)** |
| Risk | Medium. Playwright browser cache must keep `--with-deps` until an A/B run proves the image has Chromium's libs. `node_modules` caching is a behavioural shortcut and must be proven on one job first |
| Verification | cache hit logged; shell contracts still launch; `workspace` continues to run `npm ci` and prove lockfile integrity; native-binding step still passes |

### Batch 3 — Remaining wall clock (only if batches 1–2 leave a visible gap)

| | |
|---|---|
| Items | 13 (duration-weighted shards / 3rd shard), 40 (shared `.next` artifact), `next build` cache |
| Expected | ~120 s → **~110 s** (−61 % vs baseline) |
| Why last | build (53 s) + install + Playwright is the floor (~90–100 s); the marginal gains are small and each adds an artifact or a cache to maintain |
| Note | item 13 is already satisfied by Vitest's round-robin for this duration profile; only revisit if shard durations differ by >15 % over 5 runs |

### Batch 4 — Correctness fixes found by the audit (not speed; separate approval)

| Item | Change | Why it matters |
|---|---|---|
| 8 | `cancel-in-progress: ${{ github.event_name == 'pull_request' }}` | today a newer push to `main` can cancel the exact-SHA validation run the mobile release gate looks for (observed `40821834402`) |
| 41 | require a completed `force_full` run (or the executed-job set) for the release SHA in `mobile-delivery.yml` | today any green partial run satisfies the gate while main pushes are path-filtered |
| 19 (low) | add a `concurrency` group to `slack-pr-ready.yml` | it currently starts a run per `check_run`/`check_suite`/`status`, adding queue noise |

These strengthen protection; they do not weaken a check. They should not be
bundled into the speed batch because they change release semantics.

### Not recommended (with reasons)

| Option | Why not |
|---|---|
| Move unified CI to Blacksmith | converts $0/unmetered 4-vCPU minutes into a capped free tier on 2 vCPU for a ~3.2k min/month workload |
| Replace `dorny/paths-filter` | it is 7 s, conservative, and already load-bearing; no measured gap |
| Enable Vitest `fileParallelism` | deliberate isolation; unproven cross-test interference; sharding gets most of the win safely |
| Sparse checkout | saves ~1–2 s and breaks `git diff --check` / delivery map / lint scope |
| Consolidate the 5 package jobs | saves aggregate minutes that cost nothing, and reduces per-package failure attribution |
| Nx/Turbo remote cache | new infrastructure for a 3-minute pipeline |
| Cache `tsbuildinfo` | single-project `tsc --noEmit`, near-zero hit rate |

---

## 4. Test matrix — what must run for each change scope

`✓` = runs, `·` = skipped by the change detector. `workspace`, `changes` and
`hygiene` always run. `lint-report` is informational (`continue-on-error`) and
force-full only.

| Check job | Docs-only | Docs/agent-context | Root `*.json` (e.g. `vercel.json`) | Web-only | Server | Packages | DB/schema | Main push | Forced full matrix | Release-sensitive |
|---|---|---|---|---|---|---|---|---|---|---|
| `changes` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `workspace` (lockfile, audit, purity, security, architecture) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `contracts` | · | · | · | · | · | ✓ | · | scope | ✓ | ✓ |
| `domain` | · | · | · | · | · | ✓ | · | scope | ✓ | ✓ |
| `application` | · | · | · | · | · | ✓ | · | scope | ✓ | ✓ |
| `data-access` | · | · | · | · | · | ✓ | · | scope | ✓ | ✓ |
| `api-client` | · | · | · | · | · | ✓ | · | scope | ✓ | ✓ |
| `server` | · | · | · | · | ✓ | ✓ | · | scope | ✓ | ✓ |
| `web` (build + browser contracts) | · | · | · | ✓ | ✓ | ✓ | ✓ | scope | ✓ | ✓ |
| `web-typecheck` *(new)* | · | · | · | ✓ | ✓ | ✓ | ✓ | scope | ✓ | ✓ |
| `web-tests` shards *(new)* | · | · | · | ✓ | ✓ | ✓ | ✓ | scope | ✓ | ✓ |
| `mobile` | · | · | · | · | · | ✓ | · | scope | ✓ | ✓ |
| `db-invariants` | · | · | · | · | · | · | ✓ | scope | ✓ | ✓ |
| `lint-changed` | · | · | ✓ | ✓ | ✓ | ✓ | ✓ | scope | ✓ | ✓ |
| `regressions` | · | ✓ | · | · | · | · | · | scope | ✓ | ✓ |
| `lint-report` (informational) | · | · | · | · | · | · | · | · | ✓ | ✓ *(recommended)* |
| `hygiene` (aggregate gate) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

Notes:

- "scope" = main pushes use the same path filters as PRs (today's behaviour);
  a merged web-only change validates the web surface, not the full matrix.
- **Release-sensitive** = `mobile-delivery` / `mobile-ota`. Today the gate checks
  only that *a* green run exists for the SHA; batch 4 would require force-full
  evidence. Until then, operate force-full manually for release SHAs.
- The `web` filter also matches `drizzle/**`, `apps/server/**`, `src/**`,
  `packages/**`, `scripts/ci/**`, `package.json`, `package-lock.json`,
  `.github/workflows/**` — so DB and server changes correctly re-run web checks.
- Rows marked "·" for a scope are satisfied by a skipped required context; the
  `hygiene` gate is the control that proves the skip was legitimate (and rejects
  skips in force-full mode).

---

## 5. Expected performance gains

| Scenario | Now (p50) | After batch 1 | After batch 2 | After batch 3 |
|---|---|---|---|---|
| Web-only PR | 281 s (299 s observed) | **~155 s** (−45 %) | ~120 s (−57 %) | ~110 s (−61 %) |
| Full-matrix main push / force-full | 285–299 s | **~155 s** (−47 %) | ~120 s (−58 %) | ~110 s (−61 %) |
| Server/package PR | ~210 s | ~155 s (web dominates) | ~120 s | ~110 s |
| Docs-only | ~80 s | ~80 s (unchanged) | ~60 s | ~60 s |
| Forced full matrix, 15 jobs | 16.7 runner-min | ~18.5 runner-min | ~16 runner-min | ~17 runner-min |

Where the batch-1 number comes from (measured components, run `41349819428`):

```
web (build+E2E)      = 5 checkout + 6 node + 40 npm ci + 51 build + 26 pw + 6 shell = 134 s
web-tests shard      = 40 npm ci + 66 (60 test + ~6 startup)                        = 106 s
web-typecheck        = 40 npm ci + 22 typecheck + 1                                 =  63 s
critical path        = max(134, 106, 63) = 134 s
end-to-end           = 8 queue + 134 + 6 hygiene + 3 tail                          = 151–155 s
```

---

## 6. Free-tier budget analysis

### 6.1 GitHub-hosted (the only runner that should carry PR validation)

| | Now | After batch 1 |
|---|---|---|
| Unified workflow runs / 30 d | **277** | ~277 (unchanged) |
| Avg runner minutes / run | ~11.4 | ~13.5 |
| Unified runner minutes / 30 d | **~3,160** | **~3,700** |
| Billable GitHub minutes | **0** (public repo; `/timing` returns `total_ms: 0`) | **0** |
| All-workflow runs / 30 d | 2,500 (mostly the 9 s Slack notifier) | ~2,500 |
| Peak concurrent jobs | 14 | ~17 of the free-plan 20 |

The trade is deliberate: **+~550 runner-minutes/30 d for −45 % wall clock, at $0**,
inside the concurrency ceiling. If this repository ever becomes private, batch 1's
+2.1 min/run would cost real money and should be re-evaluated (the cheapest
private-repo variant is 1 shard + typecheck split, still ~−25 % wall clock for
+1 min).

### 6.2 Blacksmith free tier

Keep it exactly where it is: `build-apk` only (`mobile-delivery.yml:171`), per
`docs/ci/mobile-delivery.md`. Moving PR validation there would:

- consume a capped free quota with a ~3.2k–3.7k min/month workload,
- run on 2 vCPU instead of GitHub's 4 vCPU standard public runner,
- add a third-party dependency to the only required gate,
- contradict the existing documented runner policy.

If the owner ever wants evidence, the only defensible experiment is a short A/B on
one non-required job (e.g. `mobile`) with wall-clock p50 and queue delay recorded —
not a migration of the required gate.

---

## 7. Regression risks and mitigations

| Risk | Likelihood | Impact | Mitigation / proof |
|---|---|---|---|
| A new job is skipped when it should run (filter drift) | Low | Tests silently not run | New jobs copy `web`'s exact `if:`; force-full asserts every job executes (`hygiene` check list + `unified-ci-force-full.test.mjs`) |
| Sharding drops or duplicates tests | Low | Coverage gap | Assert shard "Test Files/Tests" sums equal the unsharded 306/2313 on the rollout PR; keep `maxConcurrency: 1` inside each shard |
| Required context disappears / blocks merges | Low | PRs stuck | `web` keeps its name and trigger; new jobs are aggregated through `hygiene` only — no branch-protection edit |
| `next build` no longer type-checks some files | Very low | Type errors reach main | `web-typecheck` is blocking via `hygiene`; Next 16 build still type-checks by default (defense in depth) |
| Playwright cache serves a stale/poisoned browser | Low | Browser tests fail or validate the wrong binary | Key on `package-lock.json` hash; keep `--with-deps`; browser cache only readable from the default branch (`actions/cache/restore` in PRs) |
| Dropping `--with-deps` breaks browser launch | Medium (if attempted) | E2E red | Only after an A/B run on a branch; keep `--with-deps` in batch 2's first iteration |
| Concurrency pressure raises queue p90 | Medium | Wall-clock variance | +3 jobs only; re-measure time-to-first-job p90 over 20 runs; do not add a 3rd/4th shard without evidence |
| `node_modules` cache hides a broken install | Medium (if attempted) | Leaf jobs run on stale deps | `workspace` keeps `npm ci` + lockfile proof every run; cache key = lockfile hash + Node + OS; A/B on one job first |
| Wall-clock claim not reproduced | Medium | Wrong decision | Acceptance requires ≥10 post-change runs and p50 comparison (§9 of the audit) |
| Release gate accepts partial validation | Exists today | Release from a partially validated SHA | Batch 4 (not part of speed work): require force-full evidence for release SHAs |

### Explicitly preserved behaviour

- All 15 required contexts keep reporting; `strict` branch protection untouched.
- `workspace` remains always-on (lockfile, dependency audit, purity, security
  invariants, architecture) on every PR, including docs-only.
- `db-invariants` remains on every DB path and in force-full, with the Postgres
  service and all 15 migration-journal proof steps.
- Browser/E2E coverage remains the same two shell-contract tests, in the same job
  that builds the production bundle.
- `force_full` activation paths (`workflow_dispatch` input and
  `release/full-matrix/*` head branch) are unchanged.
- `lint-changed` still compares against the committed baseline; `lint-report`
  remains informational.
- No application source, schema, test assertion, or dependency changes.

---

## 8. Rollback plan

| Layer | Rollback | Blast radius |
|---|---|---|
| Batch 1 | `git revert` the single workflow/test commit | CI only; no data, no deployment, no product behaviour |
| Batch 2 | revert the cache steps; the pipeline returns to uncached installs | CI only; worst case is slower, never incorrect |
| Batch 3 | revert; `web` retains build + E2E by construction | CI only |
| Batch 4 | revert per change; release gate returns to today's semantics | release process only |

Because batch 1 keeps `web` as the build+E2E job, the fallback state is always the
current validated pipeline — there is no window in which a required check is
absent.

Operational rollback check after any revert: confirm a PR produces the 15 expected
contexts and that `hygiene` is green for a docs-only PR and a web PR.

---

## 9. Implementation sequence after approval

1. **Branch** `ci/perf-split-web-job` from `main`; edit only
   `.github/workflows/unified-platform-validation.yml` and
   `scripts/ci/unified-ci-force-full.test.mjs`.
2. **Local proof:** `npm run test:ci-workflow` (force-full assertions) and
   `node scripts/architecture/check-boundaries.mjs` (no impact, sanity).
3. **Parity proof on a throwaway branch:** run the unsharded suite once and both
   shards; record file/test totals (expect 306 / 2313) and durations.
4. **Open a PR** (no merge). Let the new pipeline run; compare p50 against the
   baseline in the audit; verify the docs-only and force-full paths.
5. **Report** measured before/after, then stop for merge authorization.
6. Batch 2 only after batch 1's numbers are in hand.

### Acceptance criteria for the implementation PR

- [ ] `web` still reports and still runs build + Playwright shell contracts on the
      same paths as today.
- [ ] `web-typecheck` and both `web-tests` shards are blocking through `hygiene`.
- [ ] Shard totals equal the unsharded totals exactly.
- [ ] `force_full` executes every job (dispatch and `release/full-matrix/*`).
- [ ] No branch-protection change required; all 15 contexts still report.
- [ ] Docs-only PR still runs exactly `changes` + `workspace` + `hygiene`.
- [ ] DB path still runs `db-invariants` + `web`.
- [ ] ≥10 post-change runs show p50 ≤ 175 s for web scope, or the change is
      reverted.
- [ ] Peak concurrency ≤ 18.

### Open decisions for the owner

1. Approve batch 1 as scoped (split `web`, 2 shards, no filter changes)?
2. Approve 2 shards initially, or 3 (better balance, +1 job, more concurrency)?
3. Approve batch 2 exploration (`node_modules` cache) as a measured experiment on
   a non-required job first?
4. Approve batch 4 (release-gate strengthening) as a separate PR, or defer?
