# Agent Context Index

Use this directory for current repository-local agent guidance. `AGENTS.md` is the compact repository contract; scoped `AGENTS.md` files add local rules next to the code they govern. Current behavior and normative requirements remain separate hierarchies in [`product-authority.md`](product-authority.md).

## Start here

1. [`../../AGENTS.md`](../../AGENTS.md) — repository-wide safety, authority, topology, workflow, and validation routing.
2. Read the nearest scoped `AGENTS.md` for the path you will touch:
   - [`../../apps/web/AGENTS.md`](../../apps/web/AGENTS.md)
   - [`../../apps/server/AGENTS.md`](../../apps/server/AGENTS.md)
   - [`../../apps/mobile/AGENTS.md`](../../apps/mobile/AGENTS.md)
   - [`../../packages/AGENTS.md`](../../packages/AGENTS.md)
   - [`../../scripts/ega-runner/AGENTS.md`](../../scripts/ega-runner/AGENTS.md)
3. [`../../CONTEXT.md`](../../CONTEXT.md) — product loop, vocabulary, and cross-surface mental model.
4. [`product-authority.md`](product-authority.md) — current-behavior evidence vs normative product authority.
5. [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) — living current-system map and implementation status.
6. [`../architecture/platform-monorepo.md`](../architecture/platform-monorepo.md) — application/package boundaries and dependency direction.
7. [`decision-log.md`](decision-log.md) — persisted defect vs unresolved-product-decision classifications; never an authority override.
8. [`tooling-map.md`](tooling-map.md) — harness/config loading and drift status.
9. [`testing-and-validation.md`](testing-and-validation.md) — command matrix and evidence labels.
10. [`capability-matrix.md`](capability-matrix.md) — Wave 01 source/test/config baseline and convergence-debt ledger; not runtime proof.
11. [`skill-routing-evaluation.md`](skill-routing-evaluation.md) — expected specialized-skill routing and observed/unexecuted semantic checks.
12. [`../reports/README.md`](../reports/README.md) — historical audits/design/readiness evidence index.

## Why scoped instructions

Agents do better when global rules stay short and local implementation constraints live next to the affected subsystem. A web-only agent should not spend instruction budget on Runner queue internals; a Runner agent should receive those invariants automatically when its working directory is inside `scripts/ega-runner`.

The expected discovery order is root → leaf. A deeper `AGENTS.md` may specialize local conventions, but it must not weaken root safety, authority, or approval boundaries.

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
