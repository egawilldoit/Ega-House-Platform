# EGA House Platform — First-Wave Architecture Readiness (Historical Snapshot)

> **HISTORICAL EVIDENCE — 2026-08-09. NOT CURRENT ARCHITECTURE AUTHORITY.** This document records the Stage-10 pre-merge readiness state of the original monorepo migration. The migration has since landed and evolved. Use [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) and [`platform-monorepo.md`](platform-monorepo.md) for current truth; use GitHub PR/history for exact historical branch/check state.

**Branch at snapshot:** `arch/10-compat-cleanup-readiness` (Stage 10)
**Base at snapshot:** `arch/09-unified-ci` (PR #127)
**Snapshot date:** 2026-08-09
**Snapshot status:** first-wave architecture implementation complete and pre-merge validated at that time. This evidence did **not** authorize merge, production deployment, secrets changes, or database mutation.

---

## 1. Snapshot topology

```text
apps/web
  └─> @ega/application
       └─> repository ports
            └─> @ega/data-access
                 └─> request-scoped Supabase / RLS

apps/server
  └─> @ega/application + @ega/data-access

apps/mobile
  └─> @ega/api-client
       └─> authenticated apps/server transport

@ega/api-client
  └─> @ega/contracts only
```

| Surface | Canonical location / authority at the snapshot |
|---|---|
| Web (Next.js) | `apps/web` |
| Mobile (Expo) | `apps/mobile` |
| Standalone HTTP server (Hono) | `apps/server` |
| Contracts | `packages/contracts` |
| Domain | `packages/domain` |
| Application | `packages/application` |
| Data access | `packages/data-access` |
| API client | `packages/api-client` |
| DB schema authority | `src/db/schema.ts`, `src/db/mcp-schema.ts` |
| Drizzle migration authority | `drizzle/`, `drizzle.config.ts` |

There was one DB/migration authority; `apps/web` consumed root DB modules rather than owning a second tracked schema/migration tree.

## 2. Snapshot security/RLS invariants

The first-wave Projects/Goals transport was designed around:

```text
Authorization: Bearer <Supabase access token>
                ↓
server-side Supabase token verification
                ↓
verified user.id
                ↓
AuthenticatedActor { userId }
                ↓
request-scoped Supabase client carrying that access token
                ↓
PostgREST / RLS
```

The snapshot's intended invariants were: actor identity never supplied by request payload/query/custom user-id headers; no service-role shortcut for normal product requests; mobile could not import application/data-access/server/web/DB internals; web used application/data-access directly instead of self-fetching Hono.

## 3. Snapshot CI authority

At the Stage-10 snapshot, `unified-platform-validation.yml` was the migration validation authority and covered workspace/lockfile consistency, native bindings, dependency policy, package purity, security/architecture proofs, workspace tests/typechecks, web build, mobile validation, agent/Runner regressions, lint regression policy, and generated-artifact hygiene.

Those statements describe that revision. Current commands and current CI behavior must be read from the current manifests/workflows and [`../agent-context/testing-and-validation.md`](../agent-context/testing-and-validation.md).

## 4. Snapshot dependency/lint evidence

At the time of this snapshot, dependency exceptions and a full-repository lint baseline were recorded as migration evidence. They are deliberately **not repeated here as current baselines** because advisory state, dependency graphs, and lint debt change. Review current lockfile, CI policy, and [`dependency-audit-exceptions.md`](dependency-audit-exceptions.md) instead of treating 2026-08-09 counts as permanent truth.

## 5. Retained compatibility at the snapshot

The original first wave deliberately retained Agent API, MCP, OAuth/integrations, cron/background routes, Runner, root schema/migrations, and other compatibility surfaces not yet moved through the new boundary. Current compatibility state must be established from current source; see [`platform-monorepo.md`](platform-monorepo.md).

## 6. Historical deployment boundary

This readiness artifact did not authorize deployment. It required a fresh post-merge validation/runtime phase before production claims. Production Hono deployment has since received its own living contract in [`hono-deployment.md`](hono-deployment.md); do not use this historical snapshot to infer current deployment state.

## 7. Historical evidence authority

For the original migration review, PRs #122–#128 and their then-current heads/checks were the evidence objects. For current decisions:

1. current runtime/database/external evidence outranks this snapshot;
2. current code/migrations/tests outrank this snapshot;
3. living architecture/docs outrank this snapshot;
4. this file remains useful only to explain what was considered ready on 2026-08-09.