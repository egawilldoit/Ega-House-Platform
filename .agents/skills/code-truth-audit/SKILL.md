---
name: code-truth-audit
description: Multi-pass evidence audit for repository architecture, runtime behavior, or agent context. Use when claims conflict, the user asks for deep repository truth, or architecture instructions must be changed.
---

# Code Truth Audit

## Purpose
Establish current repository truth before changing architecture or agent guidance.

## Do not use when
The task is a small, already-localized implementation with no disputed behavior.

## Required inputs
Repository/ref, requested scope, target files that must not be edited before the audit, and available runtime evidence.

## Workflow
1. Record branch/commit/status/worktrees/remotes without destructive cleanup.
2. Pass 1: map topology, entry points, persistence, integrations, tests, and documented claims.
3. Save Pass 1 evidence with `PROVEN`, `SUPPORTED`, `DOCUMENTATION_ONLY`, `INFERRED`, or `UNRESOLVED` confidence.
4. Pass 2: reopen canonical files and attack every important hypothesis; find duplicate paths, bypasses, stale docs, and failure semantics.
5. Save confirmations, disprovals, and mechanical enforcement gaps.
6. Pass 3: reopen authority files, resolve contradictions, classify implemented/partial/scaffolded/absent behavior, and design the smallest correction.
7. Edit only after Pass 3.
8. Validate links, commands, skills, affected tests, and final diff.

## Forbidden actions
Do not run the passes in parallel, treat plans as code truth, erase pre-existing work, or invent unresolved product decisions.

## Output contract
Pass comparison, final authority map, contradictions, changed files, exact validation results, remaining gaps, and an evidence-based verdict.
