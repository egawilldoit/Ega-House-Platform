# Wave 00 continuation report

## Status

LOCALLY ACCEPTED. The external non-main Vercel build leak is quarantined by
repository-level fail-closed ignore commands in both Vercel project configs.
No Vercel, GitHub, production, deployment, credential, or push mutation was
performed. External enforcement remains unverified until the coordinator's
later harmless smoke observation.

## Changed files

- `vercel.json`: added the main-only `ignoreCommand`.
- `apps/server/vercel.json`: added the same command for the API project root.
- `scripts/ega-runner/test/pr-loop-deployment-lock.test.mjs`: added executable
  coverage for `wave/00-deployment-lock`, `feature/foo`, `main`, and an absent
  ref, for both configs.

## Commits

- `007a84402851be90cac4c7669d211b06961b9ac5` —
  `fix(deploy): fail closed on non-main Vercel builds`
- The report is committed separately after this implementation commit.

## Tests and exact results

- `npm run test:ega-runner-pr-loop` before implementation: **exit 1**;
  `tests 26`, `pass 25`, `fail 1` (`vercel.json must configure an ignore command`).
- `npm run test:ega-runner-pr-loop` after implementation: **exit 0**;
  `tests 26`, `pass 26`, `fail 0`.
- `npm run typecheck:ega-runner`: **exit 0**.
- `npm run server:typecheck`: **exit 0**.
- `npm run server:test`: **exit 0**; `tests 111`, `pass 111`, `fail 0`.
- `npm --workspace @ega/server run build:vercel`: **exit 0**; esbuild emitted
  `index.js` (`1.2mb`).
- `npm run check:architecture && npm run test:architecture`: **exit 0**;
  architecture tests `21/21` passed.
- `npm run ci:security`: **exit 0**; `security-proofs: ALL CHECKS PASSED`.
- `npm run ci:purity`: **exit 0**; `package-purity: ALL CHECKS PASSED`.
- `npm run validate:agent-context`: **exit 1**. Its test phase passed
  `29/29`; the validator then reported the pre-existing instruction-chain
  byte-budget failure for 10 paths (`Configured/default maximum: 6000`).
- `git diff --check`: **exit 0**.

## Root cause

The prior `git.deploymentEnabled` declarations were repository policy but did
not independently prevent a connected Vercel Git integration from building a
non-main ref, as shown by the earlier successful feature-branch deployment.
The Vercel `ignoreCommand` is evaluated at each project root and uses Vercel's
exit semantics directly: `test "$VERCEL_GIT_COMMIT_REF" != main` returns `1`
for `main` (continue build), and `0` for non-main or absent refs (ignore build).

## Concerns

The connected Vercel projects were not authenticated or externally rechecked
in this task. The generated API bundle is ignored and was not included in the
patch. The later smoke commit/push remains intentionally unperformed.
