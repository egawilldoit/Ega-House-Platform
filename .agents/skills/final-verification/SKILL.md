---
name: final-verification
description: Evidence-based final check for an EGA House implementation or delivery. Use before claiming completion, handing off a patch, opening/merging a PR, or reporting autonomous Runner success.
---

# Final Verification

## Required evidence
- Base/head commit and final Git diff.
- Changed-file scope and generated/untracked file review.
- Exact targeted and broader validation commands/results.
- Runtime/database evidence when behavior depends on them.
- For Runner work: queue message, claim owner, lease, attempt/worktree, Hermes artifacts, changed paths, implementation commit, pushed SHA, PR, checks, preview, and terminal events as required.
- Explicit unavailable checks and external blockers.

## Workflow
1. Re-read acceptance criteria and map each to evidence.
2. Verify no pre-existing/unrelated work is claimed.
3. Re-run the minimum validation matrix.
4. Inspect final diff for secrets, bypasses, duplicate authority, and stale documentation.
5. Distinguish static, integration, supervised runtime, and external-system proof.
6. Select exactly one verdict.

## Allowed verdicts
- `COMPLETE`
- `COMPLETE — EXTERNAL VALIDATION PENDING`
- `IMPLEMENTED — RUNTIME VALIDATION REQUIRED`
- `PARTIAL`
- `BLOCKED`

Never use `COMPLETE` when a required PR, check, preview, lease/queue, database, or runtime fact was inferred rather than observed.
