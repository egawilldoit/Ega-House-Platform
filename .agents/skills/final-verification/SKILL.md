---
name: final-verification
description: >
  Use only after implementation and validation evidence exist to certify an EGA House patch, PR, handoff, or delivery claim; matching terms include verify, final check, handoff, ready, complete, and certify. Do not use for initial planning, coding, broad architecture discovery, or the first pass of code review.
---

# Final Verification

## Required evidence

- Exact base/head.
- Diff.
- Changed files.
- Validation commands with exit codes.
- Runtime/database/device evidence where relevant.
- External blockers.
- Unverified evidence.
- PR state when requested.

## Workflow

1. Re-read acceptance criteria and map each to evidence.
2. Verify no pre-existing or unrelated work is claimed.
3. Re-run the minimum validation matrix.
4. Inspect the final diff for secrets, bypasses, duplicate authority, and stale documentation.
5. Distinguish structural, static, integration, supervised runtime, discovery, and external-system proof.
6. Select exactly one verdict permitted by the task contract.

Never use a completion verdict when required evidence was inferred rather than observed.
