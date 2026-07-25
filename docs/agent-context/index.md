# Agent Context Index

Use this directory for current repository-local guidance. Determine current behavior and normative requirements using the separate hierarchies in [`product-authority.md`](product-authority.md).

## Start here

1. [`../../AGENTS.md`](../../AGENTS.md) — stable repository-wide boundaries and navigation.
2. [`product-authority.md`](product-authority.md) — current-behavior evidence and normative product authority.
3. [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) — current system map and implementation status.
4. [`testing-and-validation.md`](testing-and-validation.md) — command matrix and evidence labels.
5. [`skill-routing-evaluation.md`](skill-routing-evaluation.md) — expected specialized-skill routing and unexecuted semantic checks.

## Delivery subsystem

- [`../architecture/delivery-lifecycle.md`](../architecture/delivery-lifecycle.md)
- [`../architecture/queue-and-leases.md`](../architecture/queue-and-leases.md)
- [`../architecture/runner-and-worktrees.md`](../architecture/runner-and-worktrees.md)
- [`../architecture/hermes-execution.md`](../architecture/hermes-execution.md)

## Skill design

Repository skills are small and composable. Their frontmatter description carries the inclusion and exclusion trigger because agent skill selection may happen before the body is loaded. Product authority remains in versioned documents rather than being duplicated in every skill.
