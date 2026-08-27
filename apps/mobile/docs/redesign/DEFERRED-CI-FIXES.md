# Deferred CI Fixes — Mobile Delivery RC Tag Support

**Date:** 2026-08-26
**Branch:** `ui/mobile-redesign` (worktree `.worktrees/ui-mobile`)
**PR:** `#178` https://github.com/egawilldoit/Ega-House-Platform/pull/178
**Base at start:** `dca2dceaa3baa72352ef9a6db8c80d29029fc82a`
**Base at wave 10 start:** `147a84bf533efe9ba2328cd47b0cfcca1bef2082` (`docs: refresh agent governance` #177)

## What changed (commits on this branch, now reverted for final diff)

**Commit 955c20e — `fix(mobile-delivery): fetch RC tags for preflight`**
```
 .github/workflows/mobile-delivery.yml | 12 +++++++++++-
  - Checkout exact source SHA: add fetch-tags: true
  - Add step "Ensure tag is fetched (RC tags)": git fetch origin '+refs/tags/*:refs/tags/*' --depth=1
  - Validate source ref: TAG_SHA fallback add `|| git rev-parse "$TAG^{commit}"`
  - Build APK Checkout: add fetch-tags: true
```

**Commit 036f6b7 — `fix(mobile-delivery): checkout for publish-release`**
```
 .github/workflows/mobile-delivery.yml | 7 +++++++
  - Publish GitHub Release: add Checkout repository step before Download exact APK artifact
    with: ref: ${{ needs.preflight.outputs.source_sha }}, fetch-depth: 1, fetch-tags: true
```

## Why it was needed

**Preflight failure on RC tags (run 32907788658, 32908002981):**
```
Tag mobile-v1.0.0-rc.178 does not point to HEAD a97b8f2 (points to )
```
`actions/checkout@v5` with `ref: ${{ github.sha }}` and `fetch-depth: 1` does not fetch `refs/tags/*` by default (`fetch-tags: false`).
`git rev-list -n 1 "$TAG"` then fails (tag not present locally) → `TAG_SHA=""` → always mismatches `HEAD_SHA`.

The `is_tag` RC path is designed to be allowed (`push` tags `mobile-v*.*.*-rc.*`), but shallow checkout broke it. Fix fetches tags.

**Publish failure (run 32908384083, 32910244577 before fix):**
```
failed to run git: fatal: not a git repository (or any of the parent directories): .git
...
::error::Process completed with exit code 1. (Publish GitHub Release)
```
`publish-release` job had no `actions/checkout` step, but `gh release create "$TAG" ...` was run from `$GITHUB_WORKSPACE` which was empty (no `.git`). `gh` tries `git rev-parse` for tag existence and fails. Adding a checkout restores `.git`.

Both fixes were validated: after `036f6b7`, run `32910244577` **Preflight PASS 10s, Build APK PASS 11m32s, Launch smoke PASS, Publish PASS, Delivery summary PASS** (`conclusion: success`).

## Commit SHAs

- `955c20e3ee366292cd53b3bcc79bd9bad0ef873f` — fetch RC tags for preflight
- `036f6b780feac63a444d04f3e1d63048104d345f` — checkout for publish-release

Both were pushed to `origin/ui/mobile-redesign` and used for RC tag `mobile-v1.0.0-rc.178` builds:
- `mobile-v1.0.0-rc.178` → `a97b8f2` (initial, failed preflight)
- `mobile-v1.0.0-rc.178` → `955c20e` (failed preflight due to Unified CI not green, then failed publish)
- `mobile-v1.0.0-rc.178` → `036f6b7` (success after both fixes, Unified CI `32909881053` green)

## Why it belongs in a future separate CI PR (not this UI PR)

- Final PR diff for Wave 10 must be **mobile-only** (`apps/mobile/**` only) per governance `FINAL SCOPE MUST BE MOBILE ONLY`.
- `.github/workflows/mobile-delivery.yml` is **delivery infrastructure**, not product UI. Mixing it into the UI redesign would:
  - pollute the mobile-only proof (`git diff --name-only origin/main...HEAD | awk '!/^apps\/mobile\//'`)
  - obscure the UI change history (14 commits of component work)
  - violate the “one authorized issue as unit of work” (UI redesign vs CI pipeline)

## Recommended next step (separate PR, not now)

Create a **dedicated CI PR** (e.g., `fix/ci-mobile-delivery-rc-tags`) that:

1. Cherry-picks `955c20e` and `036f6b7` (or re-applies the two patches above) onto a fresh branch from `origin/main` (`147a84b`).
2. Keeps the exact diff:
   - `fetch-tags: true` on both checkouts
   - `Ensure tag is fetched` step
   - `TAG_SHA` fallback `|| git rev-parse "$TAG^{commit}"`
   - `Checkout repository` step in `publish-release`
3. Verifies:
   - `git diff --name-only origin/main...HEAD` shows only `.github/workflows/mobile-delivery.yml`
   - `gh run list --workflow mobile-delivery.yml --branch mobile-v1.0.0-rc.178` eventually `success`
   - `gh run list --workflow unified-platform-validation.yml --commit <SHA>` `success`

Do **not** create that separate PR in this Wave 10 worktree/branch. This document is the handoff.

## Verification that UI PR is now clean

After restoring `mobile-delivery.yml` to `origin/main` in Wave 10.0:

```
git -C .worktrees/ui-mobile diff --name-only origin/main...HEAD | awk '!/^apps\/mobile\// {print}'
# → EMPTY (expected, mobile-only)

git -C .worktrees/ui-mobile diff --check
# → 0 (no trailing whitespace after research-wave fixes)
```

The RC tag `mobile-v1.0.0-rc.178` and its release `https://github.com/egawilldoit/Ega-House-Platform/releases/tag/mobile-v1.0.0-rc.178` remain for QA until user approves next RC.

**Note:** The two workflow commits remain in branch history (`955c20e`, `036f6b7`) but their file change is reverted in the final Wave 10.0 commit, so the **final diff** contains no `.github` change. History intentionally preserves the evidence of the RC build path; the revert is the governance-compliant state.
