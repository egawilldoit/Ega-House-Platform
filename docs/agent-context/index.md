# Agent Context Index

Use this directory for current repository-local agent guidance. Keep `AGENTS.md` as the compact map and follow links to the narrow source of truth needed for the task. Current behavior and normative requirements remain separate hierarchies in [`product-authority.md`](product-authority.md).

## Start here

1. [`../../AGENTS.md`](../../AGENTS.md) — stable repository-wide safety, scope, approval, and navigation.
2. [`../../CONTEXT.md`](../../CONTEXT.md) — product loop, vocabulary, and cross-surface mental model.
3. [`product-authority.md`](product-authority.md) — current-behavior evidence vs normative product authority.
4. [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) — living current-system map and implementation status.
5. [`../architecture/platform-monorepo.md`](../architecture/platform-monorepo.md) — application/package boundaries and dependency direction.
6. [`decision-log.md`](decision-log.md) — persisted defect vs unresolved-product-decision classifications; never an authority override.
7. [`tooling-map.md`](tooling-map.md) — agent harness/config loading and drift status.
8. [`testing-and-validation.md`](testing-and-validation.md) — command matrix and evidence labels.
9. [`skill-routing-evaluation.md`](skill-routing-evaluation.md) — expected specialized-skill routing and observed/unexecuted semantic checks.

## Platform architecture

- [`../architecture/decisions/001-platform-monorepo.md`](../architecture/decisions/001-platform-monorepo.md)
- [`../architecture/hono-deployment.md`](../architecture/hono-deployment.md)
- [`../architecture/dependency-audit-exceptions.md`](../architecture/dependency-audit-exceptions.md)

## Delivery subsystem

- [`../architecture/delivery-lifecycle.md`](../architecture/delivery-lifecycle.md)
- [`../architecture/queue-and-leases.md`](../architecture/queue-and-leases.md)
- [`../architecture/runner-and-worktrees.md`](../architecture/runner-and-worktrees.md)
- [`../architecture/hermes-execution.md`](../architecture/hermes-execution.md)

## Skill design

Repository EGA skills are small and composable. Their frontmatter descriptions carry inclusion/exclusion triggers because skill selection may happen before the body is loaded. Product authority remains in versioned documents rather than being duplicated in each skill.

Historical plans, audit reports, readiness snapshots, PR inventories, and migration evidence are point-in-time evidence only unless a living document above explicitly adopts them as current authority.