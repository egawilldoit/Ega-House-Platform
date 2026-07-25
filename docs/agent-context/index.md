# Agent Context Index

Use this directory for current, repository-local guidance. Executable code and tests remain higher authority when they disagree with prose.

## Start here

1. [`../../AGENTS.md`](../../AGENTS.md) — stable repository-wide boundaries and navigation.
2. [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) — system map with implementation status.
3. [`product-authority.md`](product-authority.md) — state ownership, approvals, and forbidden bypasses.
4. [`testing-and-validation.md`](testing-and-validation.md) — command matrix and evidence expectations.

## Delivery subsystem

- [`../architecture/delivery-lifecycle.md`](../architecture/delivery-lifecycle.md)
- [`../architecture/queue-and-leases.md`](../architecture/queue-and-leases.md)
- [`../architecture/runner-and-worktrees.md`](../architecture/runner-and-worktrees.md)
- [`../architecture/hermes-execution.md`](../architecture/hermes-execution.md)

## Skill design

Repository skills are small and composable. Their frontmatter description states the trigger and scope; the body provides only the workflow and evidence contract needed for that task. Product authority remains in versioned architecture documents rather than being duplicated into every skill.
