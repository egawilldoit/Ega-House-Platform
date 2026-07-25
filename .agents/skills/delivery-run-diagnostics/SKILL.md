---
name: delivery-run-diagnostics
description: Chronological investigation of one EGA House delivery, automation run, or Runner attempt. Use when a run is stuck, failed, duplicated, stale, missing a PR/preview, or has conflicting external state.
---

# Delivery Run Diagnostics

## Required inputs
At least one stable identifier: webhook delivery ID, run UUID, Linear issue ID, queue message ID, branch, commit SHA, or PR number.

## Workflow
1. Record the investigation time and identifiers.
2. Read automation run, ordered events, artifacts, claim owner, heartbeat, lease expiry, attempt, branch, worktree, result, failure code, and PR fields.
3. Inspect queue visibility/read count/archive state without mutating it.
4. Correlate Linear authorization/context and authorized paths.
5. Inspect worktree/Git evidence, Hermes process/result artifacts, local/remote SHA, and scope findings.
6. Inspect GitHub PR/check state, Vercel state, Slack reporting, and any partial side effects.
7. Build one timeline; distinguish root cause from downstream symptoms.
8. Classify each fact `PROVEN`, `SUPPORTED`, `LIKELY`, `UNRESOLVED`, or `CONTRADICTED`.
9. Recommend the safest idempotent recovery; do not execute destructive recovery without approval.

## Output contract
Identifiers, timeline, ownership changes, first failing transition, evidence gaps, current external state, recovery preconditions, and verdict.
