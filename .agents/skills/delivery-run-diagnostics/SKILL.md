---
name: delivery-run-diagnostics
description: >
  Use for one failed, stuck, stale, duplicated, timed-out, missing-PR, missing-preview, or externally inconsistent EGA House run; matching terms include run UUID, attempt, queue message, stuck, failure, and chronology. Do not use for ordinary static code review or unrelated database exploration.
---

# Delivery Run Diagnostics

## Required inputs

At least one stable identifier: webhook delivery ID, run UUID, Linear issue ID, queue message ID, branch, commit SHA, or PR number.

## Workflow

1. Record investigation time and identifiers.
2. Read the run, ordered events, artifacts, claim owner, heartbeat, lease expiry, attempt, branch, worktree, result, failure, and PR fields.
3. Inspect queue visibility/read/archive state without mutating it.
4. Correlate Linear authorization/context and authorized paths.
5. Inspect worktree/Git evidence, Hermes artifacts, local/remote SHA, and scope findings.
6. Inspect GitHub PR/check state, Vercel state, Slack reporting, and partial side effects.
7. Build one timeline and distinguish root cause from downstream symptoms.
8. Recommend the safest idempotent recovery without executing destructive recovery unless approved.
