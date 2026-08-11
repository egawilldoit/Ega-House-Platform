# Wave 6 — lint and technical-debt reduction

## Starting evidence
Exact Wave 5 green head: `5f7ea8f74e0fd73978368d2dd37bee9a05cd5abe`.
Full-repo lint on Unified run `31487863727`: **39 errors / 51 warnings** against inherited baseline **39 errors / 53 warnings**.

## Goal
Remove inherited lint errors without changing product behavior, then deliberately recapture the lint baseline from the verified tree. Reduce warnings where the correction is mechanical and low-risk, but do not trade behavior or rule suppression for a cosmetic zero.

## Boundaries
- No feature behavior change.
- No DB/schema/secret/deploy changes.
- No Wave 4 Agent boundary work.
- Do not disable ESLint rules globally to hide debt.
- Fix source causes or use tightly scoped, documented compatibility exceptions only when a framework rule is structurally incompatible with established runtime behavior.
- Preserve Wave 2, 3 and 5 runtime contracts.

## Execution
1. Enhance lint reporting to print rule/line diagnostics for current error-level debt.
2. Fix error hotspots in descending count, validating mobile/web after each coherent batch.
3. Re-run full lint; continue until error count is zero.
4. Apply safe warning cleanup where it is mechanical.
5. Recapture `scripts/ci/lint-baseline.json` only after measured reduction.
6. Remove duplicate `wave/**` push CI trigger while retaining stacked-wave pull-request validation.
7. Run exact-head Unified Platform Validation and freeze the PR only when every blocking job is green.
