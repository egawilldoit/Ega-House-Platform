# Historical Reports and Point-in-Time Evidence

This directory indexes repository reports, inventories, audits, and migration/design snapshots that are useful as **dated evidence** but are **not living architecture or product authority**.

Use current runtime/database/external evidence, executable code/migrations/tests, and the living documents linked from [`../agent-context/index.md`](../agent-context/index.md) for present-state decisions. A report below may accurately describe its recorded revision while being stale for `main` today.

## Root-level historical artifacts

| Artifact | Snapshot date | Classification | Current-use rule |
|---|---:|---|---|
| [`../../WORK_ANALYTICS_AUDIT_REPORT.md`](../../WORK_ANALYTICS_AUDIT_REPORT.md) | 2026-06-01 | Work Analytics audit | Use for the audited implementation/performance evidence only; re-check current `apps/web` code and runtime before acting on findings. |
| [`../../ega-419-security-audit-report.md`](../../ega-419-security-audit-report.md) | 2026-06-08 | Agent API security regression audit | Use as dated security evidence only; current Agent API paths now live under `apps/web`, and current security behavior must be re-proven. |
| [`../../UNIFIED-CI-DESIGN.md`](../../UNIFIED-CI-DESIGN.md) | 2026-08-09 | Stage-9 design handoff | Historical design/provenance for the unified validation migration; current workflow/manifests are authoritative for CI behavior. |
| [`../../PR10-INVENTORY.md`](../../PR10-INVENTORY.md) | 2026-08-09 | Stage-10 inventory/execution record | Historical deletion/readiness evidence for the migration stack; do not treat branch/remote/lint counts as current. |
| [`../architecture/readiness.md`](../architecture/readiness.md) | 2026-08-09 | Stage-10 readiness snapshot | Preserved pre-merge readiness evidence; current architecture lives in [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) and [`../architecture/platform-monorepo.md`](../architecture/platform-monorepo.md). |

## Rules for reports

- Record a date and, when relevant, branch/commit/run identifiers.
- State whether the artifact is a design, audit, inventory, readiness snapshot, or runtime evidence record.
- Do not silently update old measurements/counts into “current” values; create a new dated report or update the living architecture instead.
- Do not let a historical report override an accepted ADR, explicit current authorization, or newer executable/runtime evidence.
- Prefer keeping original point-in-time evidence intact. Add a banner/index classification rather than rewriting history.
- If a report becomes a durable architecture decision, promote that decision to an ADR and leave the report as provenance.

The root artifacts remain in place in this change to avoid breaking existing references. A later dedicated cleanup may move them under `docs/reports/` only after link consumers are audited.