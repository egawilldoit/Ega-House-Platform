# EGA House Architecture

**Living current-system map. Last code-truth refresh: 2026-10-05 (current `main` product capabilities integrated with MCP V2; production deployment status is tracked separately in the final merge report).**

This document describes the repository architecture that is currently present. Executable code, migrations, runtime evidence, and external-system evidence outrank this map when the repository changes. Normative requirements live in the authority chain defined by [`docs/agent-context/product-authority.md`](docs/agent-context/product-authority.md).

## 1. Platform topology

EGA House is an npm-workspace monorepo with three product applications, five shared packages, root database authority, and a separate autonomous-delivery subsystem.

```text
                               EGA HOUSE
                                   │
             ┌─────────────────────┼─────────────────────┐
             │                     │                     │
        apps/web              apps/mobile           apps/server
        Next.js                  Expo                  Hono
             │                     │                     │
             │                @ega/api-client            │
             │                     │                     │
             └──────────────┐      │      ┌──────────────┘
                            ▼      ▼      ▼
                              @ega/contracts
                                    │
                 ┌──────────────────┴──────────────────┐
                 ▼                                     ▼
             @ega/domain                         @ega/application
                                                       │
                                                repository ports
                                                       │
                                                @ega/data-access
                                                       │
                                       request-scoped Supabase / RLS
                                                       │
                                              Supabase/Postgres

Root DB authority: src/db + drizzle/
Autonomous delivery: scripts/ega-runner + automation.* + PGMQ + Hermes/GitHub
```

## 2. Current surface map

| Surface | State | Current evidence / role |
|---|---|---|
| Web product | CURRENT | `apps/web`: Next.js routes, Server Components/Actions, UI, integrations, and compatibility APIs |
| Mobile product | CURRENT | `apps/mobile`: Expo Router native client, authenticated API consumption, local session/navigation/presentation |
| Standalone API | CURRENT | `apps/server`: Hono routes for auth, timer, projects, goals, tasks, today, and **notifications** (history, read/unread, devices, preferences); separate Vercel deployment |
| Domain package | CURRENT | `packages/domain`: platform-neutral task/project/goal rules/constants |
| Contracts package | CURRENT | `packages/contracts`: transport-neutral mobile/agent/common contracts (now includes `notifications`) |
| Application package | CURRENT | `packages/application`: projects/goals/tasks/today **plus notifications** use cases (canonical notification, delivery policy, preferences, device claim, due-reminder orchestration), read models, recurrence/focus logic, repository ports |
| Data-access package | CURRENT | `packages/data-access`: Supabase-backed repository adapters (now includes `notifications` repositories + `FcmPushProvider` via `google-auth-library` + FCM HTTP v1 and `ResendEmailProvider`) |
| API client | CURRENT | `packages/api-client`: typed cross-platform Projects/Goals/Tasks/Today **and Notifications** HTTP mechanics |
| Database/schema | CURRENT | root `src/db`, `drizzle/`, `drizzle.config.ts` remain the single schema/migration authority (now includes `notifications`, `notification_devices`, `notification_deliveries`, `notification_preferences` via `0045_notification_subsystem`; `task_reminders` evolved with `delivery_mode`/`processed_at`) |
| Notifications | CURRENT (feature) / EXTERNAL_UNVERIFIED (device push) | Canonical notification + per-device/per-email deliveries, FCM HTTP v1 (direct, not Expo Push or EAS), preferences, Android channel `task-reminders`, deep-typed `task` targets; `apps/web` cron `POST /api/cron/task-reminders` is thin orchestration via `@ega/application` |
| Mobile notifications | CURRENT (code) / EXTERNAL_UNVERIFIED (runtime) | `apps/mobile` `expo-notifications` + `expo-crypto`, persistent `installation_id` in `SecureStore`, `getDevicePushTokenAsync()` (never `getExpoPushTokenAsync`), `NotificationProvider` (permission, channel, registration, rotation, foreground/tap/cold-start, target mapper), bell + notification center + settings + reminder Push/Email/Both selector; minimal `apps/mobile/eas.json` CLI metadata exists, but no EAS Build/Submit/Update workflow is used |
| Web compatibility APIs | CURRENT | `apps/web/src/app/api/{agent,mcp,oauth,integrations,cron}` (cron `task-reminders` now thin over notification delivery) |
| Autonomous Runner | CURRENT / PARTIAL | `scripts/ega-runner`: PGMQ claim/lease, Hermes execution, Git/GitHub evidence, PR-monitor/repair work |
| Reconciliation | ABSENT / GAP | No proven canonical owner repairs every partial external side effect idempotently |

The first-wave monorepo migration is no longer merely a target architecture: the `apps/*` and `packages/*` topology is present on `main`. Historical migration-stack evidence remains in [`docs/architecture/platform-monorepo.md`](docs/architecture/platform-monorepo.md) but must not be interpreted as the current branch state.

## 3. Product request paths

### Web path

```text
Browser
  → apps/web (Next.js route / Server Component / Server Action)
  → @ega/application
  → @ega/data-access
  → request-scoped Supabase / RLS
  → Postgres
```

The web app does not need to call its own Hono deployment to reuse application logic. Transport and rendering stay web-specific; use-case and persistence authority are shared.

### Mobile path

```text
Expo UI
  → mobile session/token boundary
  → typed HTTP client / mobile API adapter
  → apps/server (Hono)
  → verified Supabase bearer identity
  → AuthenticatedActor
  → @ega/application + @ega/data-access
  → request-scoped Supabase / RLS
  → Postgres
```

Current Hono routes cover the canonical mobile Auth, Timer, Projects, Goals, Tasks, and Today API surface. Deployment/runtime details are in [`docs/architecture/hono-deployment.md`](docs/architecture/hono-deployment.md).

### Compatibility web APIs

Agent, MCP, OAuth, integration, and cron/background routes remain under `apps/web/src/app/api`. Their presence is intentional compatibility, not permission to duplicate new business authority in route handlers.

## 4. Package and dependency boundaries

Executable enforcement lives in `scripts/architecture/check-boundaries.mjs`.

Allowed direction:

```text
apps/web      -> @ega/domain / @ega/contracts / @ega/application / @ega/data-access
apps/server   -> @ega/domain / @ega/contracts / @ega/application / @ega/data-access
apps/mobile   -> @ega/domain / @ega/contracts / @ega/api-client
@ega/api-client  -> @ega/contracts
@ega/application -> @ega/domain / @ega/contracts + repository ports
@ega/data-access -> @ega/application ports + request-scoped Supabase
@ega/contracts   -> platform-neutral primitives
@ega/domain      -> platform-neutral primitives
```

Important executable prohibitions include:

- mobile cannot import `@ega/application`, `@ega/data-access`, web/server internals, or root DB modules;
- server cannot import web/mobile/root `src` internals;
- contracts/domain cannot depend on React, React Native, Next, Supabase, or Drizzle;
- api-client cannot depend on Expo/React/Next/Supabase/application/data-access or app internals.

These boundaries keep product authority reusable without coupling platform runtimes together.

## 5. Authentication, persistence, and RLS

For normal user-scoped Hono requests:

```text
Authorization: Bearer <Supabase access token>
        → server-side token verification
        → verified user.id
        → AuthenticatedActor { userId }
        → request-scoped Supabase client carrying the caller token
        → PostgREST / RLS
```

Actor identity must not come from JSON/FormData/query/custom user-id fields. A service-role or unrestricted raw-DB client is not a valid authorization shortcut for normal product requests.

Root database ownership is intentionally separate from `apps/web` and `apps/server`:

- `src/db/schema.ts`
- `src/db/mcp-schema.ts`
- `src/db/client.ts`
- `drizzle/`
- `drizzle.config.ts`

Do not infer that physical app placement owns schema authority.

### Database boundary proofs (`scripts/db/*.mjs`)

The MCP guarantees above are claimed about *behaviour at the database*, so they are proven by ephemeral-database verifiers rather than by application tests. Every verifier applies the full `drizzle/meta/_journal.json` plus a minimal Supabase shim (GUC-backed `auth.uid()`/`auth.jwt()`, the Supabase roles, the `0043` reconciliation-owner row, the `automation.implementation_runs` stand-in) to a Postgres named by `--url`, and each begins by dropping and recreating the `public`, `auth` and `automation` schemas with `DROP SCHEMA … CASCADE`. **Every existing schema in that database is therefore destroyed, and every verifier must only ever be pointed at a disposable container.** They take `--url <postgres-url>`, `exit 2` without it, and none of them drops the database itself — the damage is total at the schema level. Every verifier that exists at this revision, and what each one proves:

| Verifier | Proves |
|---|---|
| `scripts/db/mcp-oauth-surface-verify.mjs` | What an MCP OAuth bearer can actually do *at the database*, as opposed to what the advertised `ega_*` contract permits at `/api/mcp`: SCOPE-V1 / SCOPE-V2 (a v1 grant reaches exactly the v1 surface and nothing newer), WRITE-GATE (every `client_id IS NULL` gate on a `*_direct_user_*` policy is load-bearing — driven by a principal that can already *read* the row, so no SELECT policy can hand the assertion its zero rows for free, and confirmed by an independent superuser read-back of the committed table; a qualified UPDATE OR-s the SELECT policies into its visibility filter, while a filterless one drops them from the plan entirely, which is why both shapes are probed), STATE-FENCE (a write must also be a legal *transition*: `ended_at`/`duration_seconds` on an already-closed `task_sessions` row, `status`/`remind_at` on a `task_reminders` row that is no longer `pending`, and an `archived_by` that is not `auth.uid()` are all refused, each asserted by rows affected with a superuser read-back), COLUMN-FENCE, DIRECT-USER-PARITY (the same policies do not narrow ordinary owner sessions), including that `ega_update_task {status:"done"}` and the matching reopen **work** for an MCP principal — asserted on rows RETURNED, not on the absence of an exception, since with `0078` absent the honest path raises `42501 … may not modify completed_at` and every other denial in this verifier still passes; the paired contrasts prove the `0078` exemption is not "allow the column" — a caller-supplied `completed_at` naming `status` in the same statement is refused and changes nothing, and naming `completed_at` **alone** is refused on both an already-`done` and a `todo` row with a superuser read-back of the stored value (`0083`: `normalize_task_completed_at` assigns the column unconditionally, so a negative exemption has nothing left to exempt), each with its permitted twin, a title-only `UPDATE` of the same already-`done` row that must still succeed and still carry the trigger's stamp — without that twin a fence refusing every `UPDATE` on a done task would pass, and the installed `public.tasks` trigger order is read from `pg_trigger` to prove `capture_tasks_mcp_caller_completed_at` sorts before `normalize_task_completed_at`, which is the mechanism `0078` exists to correct — so that migration can no longer be deleted from the journal with the suite green; CROSS-OWNER, RPC-SURFACE (every `authenticated`-executable function enumerated and classified; the limiter takes one argument and its limits bite at their configured values), OPERATION-IDENTITY (the replay key is the **pair** `(mcp_client_id, mcp_operation_id)` and neither half is re-keyable on UPDATE: `mcp_client_id` is the caller's **verified** OAuth client identity rather than a caller-chosen idempotency key, so a value stamped with another client's id is corrected on INSERT, and **both** identity columns are refused on UPDATE — `0079` closed the client half, `0082` the operation half, because leaving the operation half authorisable let one owner's v1 bearer re-key the v2 client's row and then have the v2 integration's replay/read-back lookup resolve it under an operation id the v1 bearer chose. Asserted **per fenced table** across all five, on rows affected *and* an independent superuser read-back of the stored pair *and* the victim client's own `(mcp_client_id, mcp_operation_id)` lookup, because `0079` and `0082` each edit every branch and a single-table regression would leave the behavioural cases green. Each refusal is paired with its permitted twin — the caller's own complete identity write still inserts unchanged, and an advertised column of the caller's own identity-bearing row still updates — so a fence that refused every identity write, or that froze the row rather than the key, fails here rather than passes; `0074`'s both-or-neither pairing still refuses a half identity with 23514), REVOCATION (asserted for **each** single column a grant can be revoked by — `revoked_at` alone with `status` left `'active'`, and `status` alone with `revoked_at` left `NULL` — since both halves of `private.has_active_mcp_permission`'s `status = 'active' AND revoked_at IS NULL` are load-bearing and the two orderings are proven independent; plus a catalog assertion that every installed copy of that predicate carries the same `revoked_at IS NULL` guard and that no row-level policy inlines the predicate at all), WRONG-CLIENT, WRONG-RESOURCE, INTERNAL, AUDIT-TOOLS, GRANT-SHAPE |
| `scripts/db/mcp-receipt-invariant-verify.mjs` | The `0052` receipt contract end to end: CLAIM-FIRST, CLAIM-DUP, STORE-REPLAY, CONFLICT, TOKEN-GUARD, LEASE-RECOVERY, FAIL-FINAL, FAIL-RETRY, FAIL-CLOSED, plus DOMAIN-FENCE proving the `0059` operation fences across a receipt loss, lease expiry, fresh claim and canonical replay for all five create tables |
| `scripts/db/mcp-normal-user-rls-verify.mjs` | That ordinary direct-user (non-OAuth, `client_id` absent) sessions retain their owner-scoped access after the MCP hardening migrations |
| `scripts/db/task-status-events-invariant-verify.mjs` | The `task_status_events` append-only ledger and the canonical `completed_at` invariant (backfill, insert, transition, re-complete, reopen, hard-delete refusal) |
| `scripts/db/timer-invariant-verify.mjs` | `task_sessions_owner_open_unique`: one open timer per owner (RED before the migration, GREEN after), closed-session freedom, RLS unchanged by the migration, re-application idempotent |
| `scripts/db/project-purge-invariant-verify.mjs` | `public.purge_archived_project`: atomic purge of all project-owned rows, name confirmation, staleness detection, an OAuth `client_id` context refused (SQLSTATE 42501), foreign-owner refusal, and whole-transaction rollback |
| `scripts/db/mcp-operation-fence-verify.mjs` | That each `0059` operation fence is enforced by the index that is *named*, not by any unique index that happens to refuse the row: catalog identity (UNIQUE, valid, ready, ordered key columns, exact partial predicate) read from `pg_index`; refusal attributed by equality on the server-reported `constraint_name`; PAIRING-RED proving the `0074` NULL-identity hole on the journal at 0072 and PAIRING-GREEN proving `0074` closes it while still accepting a complete identity; SCOPE (a different owner or client with the same operation id is NOT refused); INCIDENTAL (every competing unique index refuses its OWN collision under its OWN name); CONCURRENT (N separate sessions at a barrier, with an observer requiring N-1 backends blocked in `pg_stat_activity`); COVERAGE (the fenced-table set and key column types are asserted from the catalog, so a sixth fenced table or a widened key column cannot slip in unproven) |
| `scripts/db/mcp-upgrade-path-verify.mjs` | That the hardening tail upgrades **existing data**, not just empty schemas, from two boundaries: `0049` (the pre-hardening edge, where it terminalises legacy consent documents without mutating a stored one, and where zero canonical v1 grants are admissible — asserted, not assumed) and `0063` (the last tag before the write-column fence and permission-version keying, where real v1 grants exist and must survive). Seeding is asserted non-empty per table before any survival or authority claim: 15 tables / 41 rows at `0049` and 16 tables / 45 rows at `0063` (`ALWAYS_SEEDED_TABLES` plus `POST_0063_TABLES`, which 0063 creates), 9 then 13 grants. Also proves authority is identical before and after, that exactly the 7 legacy grants terminalise and no canonical grant does, that every new CHECK and NOT NULL accepts historically valid rows (including the `NOT VALID` 0074 constraints, which the catalog records no validation of), that a direct-user session still reads and writes, that unknown and drifted documents fail closed atomically, and that replaying the tail leaves every data digest unchanged. **IDENTITY-PAIR** holds the five `0074` pairing constraints at their deliberate final state: each carries exactly 0074's predicate, each is asserted `convalidated = false` with its `NOT VALID` marker intact, and each refuses an operation-id-only `INSERT`, a client-id-only `INSERT` and a half-pairing `UPDATE` with 23514 **attributed by equality to that constraint**, while the complete pair is still accepted — the enforcement `NOT VALID` does not give up. **IDENTITY-PAIR-LEGACY** then builds the legacy shape the pre-0074 journal actually admitted: a partial-identity row per fenced table seeded at the `0063` boundary, the whole tail applied over them (`0074` included), `0074`'s own header pre-flight query **read out of the migration file and executed verbatim** naming exactly those rows, `VALIDATE CONSTRAINT` refusing 23514 on every table holding one, every seeded digest unchanged, and NEW partial writes still refused alongside the tolerated rows. That last section is why the constraints' final state is `NOT VALID` and not `VALIDATE`d: a validating migration would refuse to apply to exactly the deployments that legitimately hold such a row |
| `scripts/db/mcp-rate-limit-concurrency-verify.mjs` | That the rate limiter holds under genuine concurrency: the shipped limits engage at their configured values (per-tool 120/min; aggregate `read` 600, `write` 300, `sensitive_write` 60); N concurrent calls on separate connections never admit more successes than the threshold; isolation across client, owner, risk class, revoked grant and wrong `aud`; a configured bucket that cannot be evaluated fails closed; and — enumerating every `SECURITY DEFINER` function in `public/` — that none leaks `EXECUTE` to `anon`, plus a direct drive of the grant showing `anon` cannot invoke the limiter even after setting `request.jwt.claim.sub`/`claims` to a real owner's identity |
| `scripts/db/journal-order-verify.mjs` | That the **real** `drizzle-orm` migrator applies every remaining journal entry rather than skipping it silently. `drizzle-orm` applies an entry only when the highest recorded `created_at` in `drizzle.__drizzle_migrations` is strictly less than that entry's `when`, so `when` is the only ordering it honours — array position and `idx` are never consulted. This journal shipped 0074/0076/0077 sharing one `when`, with 0074's lower than 0073's, which made `migrate()` report success while applying only 0078. From four tail boundaries (0072, 0073, 0074, 0077) it drives the real migrator and asserts every remaining entry took effect by OBSERVABLE EFFECT — the five 0074 pairing constraints, 0077's `jsonb_array_length` pin, 0078's `capture trigger` — not by the recorded count alone. Its database-free sibling `scripts/ci/journal-order.test.mjs` asserts the journal's shape in the unconditional `regressions` job |
| `scripts/db/mcp-schema-drift-verify.mjs` | That the **declarative** schema cannot regress the permission-version model the migrations own. It applies the journal as CATALOG-TRUTH, renders `src/db/mcp-schema.ts` through `drizzle-kit generate` as DECLARED-DDL, and asserts BYTE-EQUALITY of every `pg_constraint` definition on `public.mcp_authorization_grants` (5 of 6 byte-identical; `…_resource_uri_check` is a documented 0037 over-escaping divergence), ACCEPTANCE equality over a 34-row corpus evaluated against both sides, CORPUS-BEHAVIOUR (18 legitimate rows accepted, 16 widening rows refused, both sides), and PUSH-IS-SAFE: after a real `drizzle-kit push --force` the three security constraints are still present, byte-identical, and the real table still refuses all 16 widening rows with 23514 while still accepting all 18 legitimate ones. No database is needed for its database-free sibling `scripts/db/mcp-schema-drift.test.mjs`, which asserts the same properties against the rendered DDL text alone |

These are the complete set at this revision, and `scripts/ci/audit-production.test.mjs` asserts that this table names every `scripts/db/*.mjs` that exists, so a new verifier cannot be added without being described here. A migration with no verifier is not thereby defective, but its claim is unproven at the database and must not be described here as proven.

### Migration journal ordering (`scripts/ci/journal-order.test.mjs`, `scripts/db/journal-order-verify.mjs`)

`drizzle-orm`'s migrator does **not** walk the journal positionally. In `pg-core/dialect.js` it reads one number — the highest `created_at` in `drizzle.__drizzle_migrations` — and applies an entry only when that number is strictly less than the entry's `when`:

```sql
select id, hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 1
-- then, per entry: if (Number(lastDbMigration.created_at) < migration.folderMillis) apply
```

So `when` is the **only** ordering the migrator honours; array position and `idx` are never consulted. Every other proof in `scripts/db` applies the journal with the repository's own per-file applier, which walks the array and therefore cannot observe this at all.

This journal shipped three entries sharing `when = 1787880000023` (0074, 0076, 0077), with 0074's value **lower** than 0073's `1787880000024`. Against any database already migrated through 0073, `1787880000024 < 1787880000023` is false, so `migrate()` reported success, applied only 0078, and silently never applied 0074/0076/0077 — leaving no operation-identity pairing constraint, no rate-limiter `EXECUTE` grant, and the pre-0077 permission-document constraint, with no error and no repair path except hand-editing the migrations table. Re-stamped to a strictly increasing, unique sequence; every other entry keeps its existing value, so a deployment recorded at 0072, 0073 or 0078 still sees a valid tail ahead of it.

Two guards, because the shape and the behaviour are different claims:
- `scripts/ci/journal-order.test.mjs` (`regressions`, unconditional, no database) asserts `when` is numeric, strictly increasing and unique across all entries, that `idx` is dense and matches journal order, and that the journal tags and the `drizzle/*.sql` files are the same set in both directions — so an orphaned migration file can never be one that is never applied.
- `scripts/db/journal-order-verify.mjs` (`db-invariants`) drives the **real** `migrate()` from four tail boundaries (0072, 0073, 0074, 0077) and asserts each remaining entry was applied by **observable effect** — the five 0074 pairing constraints, 0077's `jsonb_array_length` pin, 0078's capture trigger — rather than by the recorded count alone.

Measured sensitivity: restoring the three colliding `when` values turns the static guard red (3 of 7 tests, naming all three offending transitions) and the behavioural verifier red with `recorded 1 of the 4 remaining entries`.

### Declarative schema drift guard (`scripts/db/mcp-schema-drift.test.mjs`)

`drizzle.config.ts` lists `src/db/mcp-schema.ts` in `schema`, so it is an input to `db:generate`/`db:push`, not a description of the database: `push` DROPS any CHECK the file omits and never recreates it. The MCP permission-version model therefore has two owners — the migration journal (`0057`, `0066`, `0077`) and this declarative mirror — and `scripts/db/mcp-schema-drift.test.mjs` (`npm run test:mcp-schema-drift`, wired into the always-running `regressions` job) proves they agree: it renders the file through `drizzle-kit generate` and asserts every journal CHECK is declared under the same name with the same predicate, that `permissions_version` is `IN (1, 2)` rather than `> 0`, and that the documents pinned by `…_profile_permissions_check` are exactly those in `apps/web/src/lib/mcp/permissions.ts` plus the legacy/retired documents the journal keeps representable. The mirror keeps a local copy of those literals rather than importing them, because `src/db` is the schema authority beneath every transport while `apps/web` is a consumer of it; the equality assertion is what keeps that copy from becoming a second source of truth. `scripts/db/mcp-schema-drift-verify.mjs` is the database half, wired into `db-invariants`.

One divergence is reported rather than fixed, in both files: `drizzle/0037` over-escaped the loopback alternation of `…_resource_uri_check`, so the migration's own regex cannot match `127.0.0.1` while the declarative schema's can. Migration truth is not unambiguous there, so neither side is changed by this alignment.

## 6. MCP v2 (2026-07-28) — modern-only stateless agent interface

`apps/web` hosts the MCP endpoint at `POST /api/mcp` (stateless, `createMcpHandler`-style).

```text
MCP client (SDK v2, 2026-07-28)
  → POST /api/mcp
  → Authorization: Bearer <Supabase JWT> (aud=resource, client_id)
  → verifyAccessToken → loadActiveMcpGrant → principal (owner, client, grant, permissionsVersion, permissions)
  → MCP_AUTHORIZED_SCOPE + has_active_mcp_permission(perm) + RLS (private.has_active_mcp_permission)
  → permission-aware tool catalog (read vs workspace_manager)
  → audited handler (rate limit + audit)
  → AuthenticatedActor{userId: principal.ownerUserId}
  → @ega/application (workflow authority, no duplication)
  → @ega/data-access (Supabase adapter, request-scoped client)
  → PostgREST/RLS
```

- **SDK:** `@modelcontextprotocol/server` `2.3.0` / `client` `2.3.0` / `core` `2.3.0` (`zod` `^3.25.0` + `zod-v4` alias `npm:zod@^4.2.0` for MCP schemas per SDK guide), protocol `2026-07-28` only, stateless per-request `createMcpHandler` with `legacy: "reject"` → `handler.fetch(request,{authInfo})` → `ctx.http.authInfo`, `ServerContext` (`ctx.mcpReq.inputResponses`, `ctx.mcpReq.requestState<T>()`).
- **Discovery:** `server/discover` via `createMcpHandler` (ttl 0, private); `MCP-Protocol-Version` is required and must be `2026-07-28`, while `Mcp-Method`/`Mcp-Name` are validated against body (400 / `-32020`) and never authorized; no `Mcp-Session-Id`.
- **Auth/Host/Origin:** `withEgaMcpAuth` verifies bearer → `loadActiveMcpGrant` → `principal`; `web-transport-handler` does explicit `Host` (`request.url` host) and `Origin` (allow missing for server-to-server, else must match `resource.origin`, localhost dev allowed), bounded body, correct POST/OPTIONS/GET, CORS `Authorization, Content-Type, MCP-Protocol-Version, Mcp-Method, Mcp-Name`.
- **Hardening model — why the fence has to live at the database.** The MCP runtime authenticates with the raw OAuth access token and hands that *same* token to PostgREST as the `Authorization` header (`apps/web/src/lib/mcp/supabase-user-client.ts`). An MCP OAuth bearer therefore resolves to the **same Postgres role (`authenticated`)** as an ordinary browser session. The only claim distinguishing them is `client_id` (absent ⇒ direct user). Nothing above PostgREST constrains a replayed bearer: not the Zod `.strict()` input objects, not `MCP_WRITES_ENABLED`, not tool discovery, not `Mcp-Method`/`Mcp-Name`. Consequently:
  1. **Identity** comes from the verified JWT, never from tool arguments. `resolve_active_mcp_grant()` (`0060`) resolves the grant from `auth.uid()`, `auth.jwt() ->> 'client_id'` and `auth.jwt() ->> 'aud'` matched against the stored `oauth_client_id` / `resource_uri` with `status = 'active'` and `revoked_at IS NULL`; `revoked_at` and `WRONG-CLIENT` / `WRONG-RESOURCE` are proven refusals, not comments.
  2. **`aud` / resource binding** — a token minted for another resource resolves no grant, so it authorizes nothing.
  3. **Active grant resolution** is re-checked on *every* security-relevant call, not cached at connect time: the audit RPC and the rate-limit RPC both re-derive it, so revocation takes effect immediately.
  4. **`(permission_profile, permissions_version)` → immutable permission document** — the grant's stored `permissions` array is its authority, and it is valid only for one pair; `drizzle/0066` pins both the version value and the document shape in SQL. A grant therefore cannot be widened by editing a profile, and a v1 row keeps exactly the 14 permissions it was consented for.
  5. **RLS / column / state / RPC fence** — four separate layers, because they answer different questions. RLS (`0051`–`0056`, `0065`, `0070`) is a *row* predicate and can only answer "does this grant hold `tasks.update`"; the column fence (`0064`, extended by `0068`/`0069`, with the allowlists re-derived in `0071`) is a `BEFORE INSERT OR UPDATE` trigger that answers "did this grant change only the columns the tool advertises", and it refuses with SQLSTATE 42501, forcing defaults for non-insertable columns; the state fence (`0081`) answers the question column authority cannot — "is this write a legal *transition*" — and refuses `ended_at`/`duration_seconds` on an already-closed `task_sessions` row, `status`/`remind_at` on a `task_reminders` row that is no longer `pending`, and an `archived_by` that is not `auth.uid()`; the RPC surface (`RPC-SURFACE`) answers "which functions may this role execute at all". One INSERT column is *reserved* rather than resettable, because a silent reset would report success for a write the caller did not get: `tasks.completed_at` (`0080`). Resetting it also erased the completion instant `normalize_task_completed_at` had just stamped, so `ega_create_task` with `status: "done"` landed a permanently NULL `completed_at` and violated `0063`'s "non-null if and only if the status is a done spelling" invariant on the MCP path only; from `0079` the normalizer's stamp survives and a caller-supplied value is refused. The rule is at either verb, and on UPDATE it has to be asked of the capture trigger *positively*. `0078` exempted the column only while that trigger proved the caller supplied nothing, but the exemption is a no-op once the caller's value is gone: `normalize_task_completed_at` assigns `NEW.completed_at` unconditionally on UPDATE (`OLD.completed_at` when already done, `NULL` when not), so a statement naming `completed_at` **alone** had already changed nothing by the time the fence diffed OLD against NEW, the column never entered the forbidden set, and the statement returned rows=1 reporting success — success-shaped data for a write the caller did not get, which is exactly what `0080` refuses on INSERT. The sibling statement naming `status` *and* `completed_at` was already refused 42501, because there the normalizer's `COALESCE` preserves the caller's value long enough to be seen. `0083` consults the capture GUC positively on the UPDATE branch too, so the rule holds at either verb; the `= 'false'` exemption is untouched and remains the only route an honest `ega_update_task {status:"done"}` / `{status:"todo"}` takes through the column, and a title-only edit of the same already-done row still succeeds.
  6. **Audit authority** — `record_mcp_audit_event` (`0061`) is a claim-bound `SECURITY DEFINER` RPC that derives owner/client/resource/grant from JWT context, because direct OAuth INSERT into `agent_integration_events` stays blocked; `0067` narrows the accepted tool identities to exactly the registry, so the auditable surface cannot be wider than the invocable one.
  7. **Rate limiting** is distributed (owner + client + window name) and server-parameterised, for the reason in the Audit/Rate bullet: an MCP bearer holds the credential the limiter protects.
  8. **Receipts and domain-operation fencing** (`0052`, `0059`) make the exactly-once claim hold across receipt loss, lease expiry and stale-worker recovery rather than only in the happy path.
  These are *runtime/database* claims and each is proven by the matching `scripts/db` verifier above; application tests alone cannot prove them, because they would only exercise the path the tools advertise.
- **Reads runtime:** `ega_get_capabilities`, `ega_list_projects`, `ega_list_goals`, `ega_list_tasks`, `ega_get_today_plan` (via `SupabaseTodayReadPort`), and `ega_list_timer_sessions` (via `SupabaseTimerSessionRepository`) — owner-scoped, bounded, strict `zod-v4` schemas, no `ownerUserId` from caller.
- **Executable tool count — 30 (7 read + 23 write) — is authored in exactly one place:** the `MCP_CAPABILITIES` array in `apps/web/src/lib/mcp/capability-registry.ts`. That registry states, per capability, its permission requirement, mutation/destructiveness/idempotency, writes-enabled requirement, risk class and confirmation class; tool discovery, registration eligibility, the rate-limiter risk class, the MCP tool annotations and the database audit allowlist are all derived from it, and `capability-registry-migration.test.ts` pins both the runtime registry and the `drizzle/0067` SQL allowlist to each other in both directions. A number written in prose is therefore not a second source of truth. The registry lists ONLY capabilities that already have a registry entry, Zod schema, handler, application delegation and tests, added in the same wave; a planned capability that appeared there without a handler would advertise something not invocable and would widen the auditable database surface with no tool behind it.
- **Writes runtime (23):** the catalog covers project, goal, task/reminder, Today, and timer create/update/archive operations; `ega_clear_completed_today` uses MRTR `inputRequired` + `requestState`. All writes require `operationId: uuid`, `workspace_manager` permission where applicable, `MCP_WRITES_ENABLED`, and the fail-closed ledger. The complete runtime catalog and profile matrix live in [`docs/implementation/2026-08-28-mcp-capability-coverage.md`](docs/implementation/2026-08-28-mcp-capability-coverage.md).
- **MRTR:** `MCP_REQUEST_STATE_SECRET` (32+ bytes, shared) → `createRequestStateCodec({key, ttlSeconds:300})` HMAC-SHA256 `base64url(json{ p, exp })` `timingSafeEqual`, binding `{user,client,grantId/version,resource,tool,operationId,argsHash,targetDate,phase}`; `ServerOptions.requestState.verify` + `ctx.mcpReq.requestState<T>()` + `inputRequired`/`acceptedContent`; tamper/expiry/grant-revoked/args-changed → `-32602`/`INVALID_ARGUMENT`.
- **Idempotency:** `mcp_mutation_receipts(owner,client,tool,opId,args_hash,result_payload)` PK + `mcp_claim_mutation_receipt`/`mcp_store_mutation_result` SECURITY DEFINER with `ON CONFLICT` and `pg_advisory_xact_lock`, fail-closed, `createHash(sha256, canonical JSON)` for args. Create-domain fencing is complete for projects, goals, tasks, reminders, and sessions: domain inserts carry the authenticated owner/client operation identity, and only the matching named unique collision replays the canonical row through request-scoped RLS. The fence is the partial unique index `<table>_mcp_operation_unique` on `(owner_user_id, mcp_client_id, mcp_operation_id) WHERE mcp_operation_id IS NOT NULL` (0059), and 0074 adds `<table>_mcp_operation_identity_pair` requiring that identity to be complete: btree unique indexes treat NULLs as distinct, so a row with `mcp_operation_id` set and `mcp_client_id` NULL matched nothing and the fence was inert for it, which also defeated the `mcp_client_id = <client>` replay lookup. Each refusal is attributed to one named index rather than accepted as "some unique index on the table"; `scripts/db/mcp-operation-fence-verify.mjs` proves the catalog shape, the named attribution, and that N simultaneous attempts leave one durable row. The half of that identity a caller **chooses** is the operation key; the half that identifies *who* is asking is not a choice, so `0079` derives `mcp_client_id` from `auth.jwt()->>'client_id'` on INSERT (correcting a supplied value, leaving a NULL NULL so `0074`'s both-or-neither pairing still refuses a half identity) and drops it from `private.mcp_writable_columns()` so an existing row's client id cannot be re-stamped. Until then an owner holding two grants could write a row under the other client's id with their own bearer and have that client's replay return it as its own result — a hole in exactly this key. That closed the INSERT direction only; the replay key is the **pair**, so `0082` removes `mcp_operation_id` from `private.mcp_writable_columns()` as well. Freezing the client half while the operation half stayed authorisable left the pair re-keyable: the v1 bearer could re-key the operation id of a row the v2 client created, and that re-key was durable, after which the v2 session's own replay lookup on `(v2-workspace-client, <the v1 bearer's operation id>)` resolved the v2 client's row. Neither half is authorisable on UPDATE now; both remain authorisable at INSERT, which is where the caller legitimately chooses the idempotency key its row is created under. No advertised tool re-keys either half on UPDATE — every `mcpOperationId` write in the application is inside an `.insert(...)` payload on a create path — and an identity-bearing row is not frozen, only its identity columns are.
- **Update guarantee:** status, archive, Today projection, and timer stop/clear mutations remain at-least-once but idempotent; the exactly-once claim is limited to insert-style create effects.
- **Audit/Rate:** `agent_integration_events` is written by `record_mcp_audit_event` (0061), a claim-bound `SECURITY DEFINER` RPC that derives OAuth owner/client/resource and active-grant identity from the verified JWT; `consumeMcpRateLimit` remains RPC-backed against the distributed `consume_mcp_rate_limit` window (owner + client + window name, re-checking the active grant on every call). The per-tool allowance is 120/min for every tool: the "writes 30/min" this line previously claimed was never implemented, and tightening an existing client's allowance is a product decision rather than an implementation choice, so the claim is corrected here instead. Each capability additionally carries a risk class (`read` / `write` / `sensitive_write`) in the canonical registry, and the RPC derives a per-client aggregate allowance for that class (`ega_aggregate_read` 600/min, `ega_aggregate_write` 300/min, `ega_aggregate_sensitive_write` 60/min), so total throughput cannot multiply as the tool count grows. The signature is `consume_mcp_rate_limit(p_window_name text)`: the allowance and the window length are derived server-side from the window name and are NOT caller-supplied. Until 0071 both were arguments, and because the conflict handler treats a window mismatch as a fresh bucket, one extra RPC call reset the counter while `p_limit=10000` disabled the limit outright; the superseded three-argument overload is dropped rather than left callable. These thresholds are a starting position rather than a ratified quota and are recorded here for that decision. The RPC's distribution, its grant re-check, its client binding and the fact that the shipped limits bite exactly at their configured values are proven by `scripts/db/mcp-oauth-surface-verify.mjs` (RPC-SURFACE). Audited handlers stay fail-closed for required read audit persistence.
- **Migrations:** current-main migrations `0045_notification_subsystem` through `0049_operator_proposals` are followed by MCP migrations `0050_mcp_workspace_manager` through `0079_mcp_client_id_derivation`, `0080_mcp_completed_at_insert_authority`, `0081_mcp_write_fence_state_transitions` and `0082_mcp_operation_id_update_authority`; production application status is environment-specific and must be verified from migration history.
- **Permission versions:** v1 is what is *issued* — `CURRENT_MCP_PERMISSION_VERSION = 1` in `apps/web/src/lib/mcp/permissions.ts`, so every newly consented grant is written at version 1. v2 is *defined and frozen but not issued*: `PERMISSION_DOCUMENTS` defines `read_only@2` and `workspace_manager@2` as v1 plus five additive read-only permissions (`friction.read`, `inbox.read`, `notifications.read`, `operator.read`, `workload.read`), and `drizzle/0066` constrains both the version value and the exact document shape in SQL. `task_manager` deliberately has no v2 document, so that "an invalid (profile, version) pairing fails closed" remains testable. Because v2 is not issued, those five v2 permissions are currently granted to nobody and have no tool behind them. The switch to 2 happens once, in the same wave that ships the v2 tools; authority beyond a frozen document is v3, never an edit to v2.
- **Deferred capability expansion (NOT shipped):** the friction / inbox / notifications / operator / workload read domains named in the registry's `McpDomain` union, plus saved-view and idea-note reads and writes, remain deferred. `McpDomain` is a type union, not a registry entry, so listing those domains is not evidence of a capability. At this revision the registry contains only the seven `permissions_version 1` reads and their writes; any future v2 wave must add registry entry + schema + handler + application delegation + permission + risk class + audit identity + tests atomically.
- **Runbook:** `docs/implementation/2026-08-28-mcp-v2-read-write-runbook.md` (rollback `MCP_WRITES_ENABLED=false`, no destructive down migration).

### 6.1 Dependency and licence posture

- **Supply-chain gate.** CI runs `node scripts/ci/audit-production.mjs` as its own step ("Dependency audit high/critical policy"), **not** as part of `npm run ci:workspace` — `ci:workspace` is the registry/lockfile integrity proof (`audit-production.test.mjs` + `workspace-proofs.mjs`) and asserts properties *about* the registry without running the live audit. The gate blocks any high/critical `npm audit --omit=dev` advisory that is not a structured exception in that file. An entry names one advisory source id on one **non-empty, concrete** package (no wildcard, no blank) and carries a `reviewBy` date; an entry that is expired, or whose `reviewBy` or whose `package` is malformed, is reported as a blocking finding in its own right (`temporary risk acceptance expired on …`, `malformed reviewBy date format: …`, `malformed exception package: …`) rather than being honoured, and an entry matching one advisory does not excuse any other. The `package` check is equality rather than "skip the comparison when unset": a blank package is falsy, so treating it as "no opinion" would accept the advisory on *any* package and turn one entry into a blanket exemption. So the registry is not a blanket allow-list.
- **`next` 16.3.8** is the current pin in `apps/web/package.json` (was 16.3.5). GHSA-vcvr-r3jv-pc5j is treated as a **critical RCE in `next/og`**, and it was **upgraded past rather than excepted** — `audit-production.test.mjs` asserts that no registry entry ever names `next` or that advisory id, so a future re-introduction would be caught. **No product code imports `next/og`**: the only `next/og` string in the repository is the comment at `scripts/ci/workspace-proofs.mjs:167` that justifies the pin, no `ImageResponse` is constructed anywhere in `apps/`, `packages/` or `src/`, and `apps/web/src/app/layout.tsx:45` sets `openGraph` metadata as plain object literals. So the vulnerable surface is not reachable from any route at this revision. The *exact* patched boundary of the advisory is **not derivable from this repository** and is deliberately not asserted here; the comment at `workspace-proofs.mjs:167` calls 16.3.8 "the first release containing the fix", which is an unverified code comment rather than a fact this document can prove.
- **Two carried audit exceptions, both in the 2026-11-05 cohort** (counted by importing `SECURITY_AUDIT_EXCEPTIONS`, not by reading prose: 2 entries, `{2026-11-05: 2}`, none expired on 2026-10-05). The full per-entry table with the reason each is unfixable today is canonical in [`docs/architecture/dependency-audit-exceptions.md`](docs/architecture/dependency-audit-exceptions.md); this map records only why the shape matters:
  - The **seven `2026-10-15` entries were remediated, not renewed** — `brace-expansion` ×6 (GHSA-qhr7-859c-m2p7, GHSA-6j4f-fj2g-mc7p) reached via `expo > react-native`, and `undici` ×1 (GHSA-rfgv-xxqx-mfg5) via `@expo/cli`. Their recorded reason, "no patched release", was wrong: each affected range has a published release outside it, and each of those releases is **inside the range its own parent already declares**, so scoped root overrides (`brace-expansion@^1 -> 1.1.21`, `@^2 -> 2.1.7`, `@^5 -> 5.0.12`, `undici@^6 -> 6.29.0`) are ordinary in-range moves, not out-of-range forcing. `npm audit --omit=dev` reports none of the seven after the change; `audit-production.test.mjs` asserts the registry never names those sources again **and** that a report carrying any of them blocks, so the remediation cannot be silently undone in either direction. It asserts the **resolved** versions in `package-lock.json` as well as the declared overrides — a declared override and the tree npm installs from are two different facts, and pinning only the declaration left a downgraded `node_modules/brace-expansion` entry green in both this file and `workspace-proofs.mjs`.
  - The **two `braces` 3.0.3** (GHSA-vfj7-8cjw-p6xm) and **`node-forge` 1.4.0** (GHSA-86w9-cpqp-85rv) entries, `reviewBy: 2026-11-05`, are exceptions **because no patched version of either has ever been published** — 3.0.3 and 1.4.0 are the newest releases that exist and the advisories list no fixed version, so there is neither an upgrade nor an override that resolves them. These two *do* carry the full governance fields (`affectedSurface`, `whyNotFixableNow`, `owner`, `upstream`, `allowDirect`) and are dropped by removing the entry the moment upstream ships a fix. `allowDirect` is load-bearing rather than a bypass: the gate attributes a leaf advisory to the *direct* package that reaches it, so removing the flag re-blocks the identical report — `audit-production.test.mjs` asserts exactly that. Reachability was checked in the lockfile rather than assumed: `braces` is reachable only via `micromatch`, whose parents are `@jest/*`, `jest-*`, `fast-glob` and `metro-file-map`; `node-forge` is reachable only via `@expo/code-signing-certificates` and `@expo/cli`, which use it to verify EAS build artifacts. Neither package is imported by any first-party source in `apps/`, `packages/`, `src/` or `scripts/`. Neither is marked `dev` in `package-lock.json`, so "build-time only" is a *reachability* statement here, not an npm-flag one — that is precisely why they are governed as expiring exceptions rather than waved through as devDependencies.
- **Third-party licences** are inventoried in [`docs/third-party-licenses.md`](docs/third-party-licenses.md). The MCP SDK packages (`@modelcontextprotocol/client` / `core` / `server`, all `2.3.0`) declare `Apache-2.0` in their `package.json` and ship an upstream `LICENSE` file at runtime but **no `NOTICE` file**; see that document for what is and is not required as a result.

## 7. Autonomous delivery architecture

The Runner is a separate control plane from the productivity product. Its durable run state belongs to the automation database; queue/Git/Hermes/GitHub/Slack are execution and evidence systems around that state.

```text
Authorized issue / trigger
        ↓
 durable automation run
        ↓
      PGMQ
        ↓
 read → claim/lease → classify
        ↓
 verified branch/worktree
        ↓
      Hermes
        ↓
 independent diff / validation / Git proof
        ↓
 push → real GitHub PR → checks/review/preview evidence
        ↓
 READY_TO_MERGE candidate
        ↓
 human merge
        ↓
 durable terminal classification + queue archive when safe
```

Never translate `completed` in one subsystem directly into delivery-level success. The terminal evidence rule in [`docs/agent-context/product-authority.md`](docs/agent-context/product-authority.md) defines what must be observed for the requested contract.

Subsystem documents:

- [`docs/architecture/delivery-lifecycle.md`](docs/architecture/delivery-lifecycle.md)
- [`docs/architecture/queue-and-leases.md`](docs/architecture/queue-and-leases.md)
- [`docs/architecture/runner-and-worktrees.md`](docs/architecture/runner-and-worktrees.md)
- [`docs/architecture/hermes-execution.md`](docs/architecture/hermes-execution.md)

## 8. Current known gaps

### Platform

- The monorepo boundaries are implemented, but feature migration coverage remains a per-surface question; do not assume every legacy/compatibility flow has been converted merely because packages exist.
- Agent/MCP/OAuth/integration/cron transports remain in the web application and must be treated as compatibility surfaces until separately migrated.
- Root DB authority is intentional; relocating schema/migrations requires a dedicated ownership decision and must not create parallel migration trees.
- Runtime/deployment proof is subsystem-specific. Static architecture checks do not prove Vercel, Supabase, mobile-device, or cross-user behavior.

### Runner

The current agent-context authority records these important delivery gaps until newer executable evidence proves otherwise:

- archive preconditions are not centrally encoded;
- lease-heartbeat failure does not by itself prove active Hermes work stopped before further effects;
- Hermes validation claims are not sufficient independent proof;
- PR/check/preview completeness has historically been weaker than the delivery-level terminal evidence rule;
- reconciliation of partial external effects lacks a proven canonical owner.

Do not preserve a gap just because it is written here: if current code/runtime now proves it closed, update this map and the decision/evidence trail in the same bounded change.

## 9. Architecture change protocol

For architecture or governance changes:

1. Read [`CONTEXT.md`](CONTEXT.md), the relevant ADR, current code, executable boundary tests, and prior [`docs/agent-context/decision-log.md`](docs/agent-context/decision-log.md) entries.
2. Establish current behavior independently from normative authority.
3. Classify contradictions as defects or unresolved product decisions.
4. Change the canonical owner rather than adding another owner.
5. Update living docs and executable guardrails together when a boundary changes.
6. Mark point-in-time evidence documents as historical instead of rewriting them into false current truth.
7. Validate with [`docs/agent-context/testing-and-validation.md`](docs/agent-context/testing-and-validation.md).
