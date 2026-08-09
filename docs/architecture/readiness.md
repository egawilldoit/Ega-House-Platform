# EGA House Platform — First-Wave Architecture Readiness

**Branch:** `arch/10-compat-cleanup-readiness` (Stage 10)
**Base:** `arch/09-unified-ci` (PR #127)
**Date:** 2026-08-09
**Status:** first-wave architecture implementation complete and pre-merge validated. This document is evidence for code/integration readiness; it does **not** authorize merge, production deployment, secrets changes, or database mutation.

> The authoritative Stage-10 head SHA and latest successful exact-head Unified Platform Validation run are the current PR #128 metadata/checks. They are intentionally not hard-coded here because editing this file changes the Stage-10 head.

---

## 1. Converged topology

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

| Surface | Canonical location / authority |
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

There is one DB/migration authority. `apps/web` consumes the root DB modules through workspace/path wiring; there is no second tracked schema or migration tree under `apps/web`.

## 2. Security and RLS invariants

Projects/Goals transport preserves this chain:

```text
Authorization: Bearer <Supabase access token>
                ↓
server-side Supabase token verification
                ↓
verified user.id
                ↓
AuthenticatedActor { userId }
                ↓
request-scoped Supabase client carrying the same token
                ↓
PostgREST / RLS
```

Verified invariants:

- Actor identity is never accepted from a request body, URL/query parameter, FormData field, or custom user-id header.
- `apps/server` verifies the bearer token before constructing `AuthenticatedActor`.
- Project/Goal repository adapters use the request-scoped Supabase client; no global privileged client is introduced.
- No service-role or unrestricted raw-DB authorization shortcut is used by the first-wave Projects/Goals path.
- Mobile cannot import `@ega/application`, `@ega/data-access`, server internals, web internals, or DB modules.
- Web Server Components/Actions use application/data-access directly and do not self-fetch the Hono server.

These properties are enforced by `scripts/ci/security-proofs.mjs` and `scripts/architecture/check-boundaries.mjs` in Unified Platform Validation.

## 3. CI validation authority

`unified-platform-validation.yml` is the first-wave platform validation authority after Stage 9. It validates the exact PR head and covers:

- workspace/lockfile consistency;
- Linux x64 optional native bindings required by Next/Vitest/Expo tooling;
- production dependency high/critical audit policy;
- package purity and dependency direction;
- security proofs and architecture current-tree/fixture checks;
- contracts/domain/application/data-access tests and typechecks;
- Hono server and API-client validation;
- web typecheck, full tests, and production build;
- mobile Doctor, typecheck, tests, and Android bundle validation;
- Agent context and Runner regressions;
- baseline-aware changed-file lint plus informational full-repo lint;
- final diff/generated-artifact hygiene.

The former migration-stage validation workflows were either superseded or removed only after equivalent/superset coverage was proven by the unified pipeline.

## 4. Dependency audit status

The production dependency gate is **PASS under an evidence-gated high/critical policy**.

- `ws` is pinned to the safe `8.21.3` resolution.
- Hono resolves above the previously affected `<=4.12.33` range.
- CI does not use `npm audit fix --force`; Expo 54 / React Native 0.81.5 compatibility is preserved.
- Remaining currently constrained high-severity advisories are accepted only by exact advisory ID and expected transitive path for `fast-uri`, `js-yaml`, `nanoid`, and `image-size`.
- Those exceptions are not blanket suppressions: a new advisory, a changed dependency path, or a direct dependency match fails the gate.
- Exception review deadline: **2026-09-09**. The gate intentionally fails after that date until the evidence is reviewed/resolved.

This is not a claim that the dependency graph has zero advisories; it is a claim that the committed policy rejects unknown/new high or critical production risk and records the currently constrained upstream exceptions explicitly.

## 5. Lint status

The final inherited full-repository baseline is:

```text
39 errors / 53 warnings
```

During the pre-merge audit, the Stage-9 baseline was found to have absorbed 5 errors and 3 warnings introduced by new Stage-8 mobile files. Those findings were fixed at their source in PR #126, its full lint returned to 39/53, and the Stage-9 baseline was deliberately re-captured at 39/53.

`lint-changed` is the blocking regression gate. `lint-report` remains informational for inherited debt. The baseline is not permission to add new problems.

## 6. Retained compatibility surfaces

The first wave deliberately retains:

- Agent API;
- MCP API;
- OAuth and integrations;
- cron/background routes;
- legacy Mobile Auth, Tasks, and Today;
- Runner and its documented standalone dependency/lockfile exception;
- root Drizzle/schema authority;
- compatibility/re-export shims that still have consumers or presentation logic;
- operational or production artifacts that require explicit owner sign-off before removal.

Stage 10 removes only artifacts proven dead or fully superseded. Lack of current imports alone is not sufficient evidence for destructive cleanup of production/operational assets.

## 7. Deployment readiness boundary

Architecture readiness is not deployment authorization.

After the ordered PR stack is merged, the required next proof is a fresh Unified Platform Validation run against `main`, followed by runtime/staging validation of:

- web boot and key web flows;
- standalone Hono server boot/health;
- bearer authentication and unauthorized rejection;
- Projects/Goals CRUD through the real Supabase/RLS path;
- native Projects/Goals against the deployed server;
- cross-user/RLS isolation;
- Agent, MCP, OAuth, cron, integrations, and Runner compatibility.

No production deploy workflow is introduced by this migration.

## 8. Evidence authority

For review and merge decisions, use the live GitHub objects rather than stale copied SHAs:

- PR #122 through PR #128 for the ordered Stage-4→Stage-10 stack;
- each PR's current base/head SHA;
- each PR's latest successful exact-head validation run;
- PR #128's latest successful Unified Platform Validation for the complete converged topology.

This prevents documentation from becoming stale when an evidence-only or audit correction advances a stacked branch head.
