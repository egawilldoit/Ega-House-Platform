---
name: code-truth-audit
description: >
  Use for disputed repository truth, architecture contradictions, deep current-behavior mapping, or agent-context changes; matching terms include audit, map, reconcile, architecture, and source of truth. Do not use for a small localized issue whose ownership and behavior are already known.
---

# Code Truth Audit

## Purpose

Establish current repository truth before changing architecture or agent guidance.

## Authority model

Read [`../../../docs/agent-context/product-authority.md`](../../../docs/agent-context/product-authority.md). Use current-behavior evidence to establish what exists and normative product authority to establish what is required. Classify conflicts as defects or unresolved decisions.

## Workflow

1. Record branch, commit, status, worktrees, and remotes without destructive cleanup.
2. Pass 1: map topology, entry points, persistence, integrations, tests, and documented claims.
3. Save evidence with `PROVEN`, `SUPPORTED`, `DOCUMENTATION_ONLY`, `INFERRED`, or `UNRESOLVED` confidence.
4. Pass 2: reopen canonical files and attack every important hypothesis; find bypasses, duplicate owners, stale docs, and failure semantics.
5. Pass 3: resolve contradictions, classify current behavior, compare it with normative authority, and design the smallest correction.
6. Edit only after Pass 3.
7. Validate links, commands, skills, affected tests, and final diff.

## Forbidden actions

Do not run the passes in parallel, treat plans as implementation evidence, erase pre-existing work, or invent unresolved product decisions.

## Output contract

Pass comparison, current-behavior map, normative authority, contradictions, changed files, exact validation results, remaining gaps, and an evidence-based verdict.
