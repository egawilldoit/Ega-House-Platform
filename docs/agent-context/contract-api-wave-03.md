# Wave 03 contract and API-client boundary inventory

**Starting snapshot:** `0f68315213589e66e1d6d9890a40779df1255e35` (2026-09-03)
**Implementation snapshot:** `b89dd2c7eaeaef7e30289e409ccc1e78816177cf` (2026-09-03)
**Verification snapshot:** `494815083e5ba338666c5890757d7d16f060f2b1` (2026-09-03)

This is the Wave 03 starting evidence. It separates capabilities that need a
native transport contract from web-only or internal capabilities. Source and
tests prove checked-in boundaries; they do not prove a deployed API, applied
migrations, RLS isolation, or Android runtime behavior.

## Canonical boundary

```text
apps/mobile
  → @ega/api-client
  → @ega/contracts
  → apps/server Hono routes
  → @ega/application
  → @ega/data-access
  → request-scoped Supabase/RLS
```

The mobile package has no imports from `@ega/application`, `@ega/data-access`,
root database modules, or server/web internals in the checked-in dependency
checks. Existing native adapters use `@ega/api-client` for Projects, Goals,
Tasks, Today, Timer, Inbox, Notifications, Friction, Health, Operator, Time
Context, and Weekly Review.

## Capability boundary matrix

| Capability | Server route | Shared contract | API-client method | Mobile use | Wave 03 ruling |
| --- | --- | --- | --- | --- | --- |
| Projects | `/api/projects` | Missing dedicated DTO | `projects.list/getBySlug/create/updateStatus/archive/unarchive` | Projects list/detail/forms | Extract DTOs from client-local `src/types.ts` |
| Goals | `/api/goals` | Missing dedicated DTO | `goals.list/create/updateStatus/updateHealth/updateNextStep/archive/unarchive` | Goals list/detail/forms | Extract DTOs from client-local `src/types.ts` |
| Tasks | `/api/tasks` | `mobile.ts`, `common/task-list.ts` | `tasks.*` | Task list/detail/forms | Preserve existing contract authority; verify exports |
| Today | `/api/today` | `operator.ts` is canonical response; stale narrow type remains in `mobile.ts` | `today.get/*` | Today tab/workspace | Make `MobileTodayResponse` the canonical Operator snapshot alias |
| Timer | `/api/timer` | `mobile.ts` | `timer.*` | Timer tab | Preserve existing contract authority; verify exports |
| Inbox | `/api/inbox` | `inbox.ts`, `inbox-ai.ts` | `inbox.*` | Inbox tab | Preserve existing contract authority; verify exports |
| Notifications | `/api/notifications` | `notifications.ts` | `notifications.*` | Notification center/settings | Preserve existing contract authority; verify exports |
| Friction | `/api/friction` | `friction.ts` | `friction.*` | Friction route | Preserve existing contract authority; verify exports |
| Health | `/api/health` | `health.ts` | `healthSnapshot.*` | Today projection | Preserve existing contract authority; verify exports |
| Operator | `/api/operator` | `operator.ts` | `operator.*` | No native surface yet | Keep API-ready; no new mobile UI in this wave |
| Time Context | `/api/time-context` | `time-context.ts` | `timeContext.*` | Indirect support only | Keep internal/indirect; no new client feature |
| Weekly Review | `/api/review` | `weekly-review.ts` | `weeklyReview.*` | Review route | Preserve existing contract authority; verify exports |
| Search | None | None | None | Local in-memory search | Not selected: no approved native API use case in this wave |
| Work Analytics | None | None | None | No mobile surface | Not selected: web-only implementation remains |
| Startup | None | None | None | No mobile surface | Not selected: web-local lifecycle decision remains |
| Shutdown | None | None | None | No mobile surface | Not selected: web-local lifecycle decision remains |

## Confirmed drift seams

### Projects and Goals

`packages/api-client/src/types.ts` currently owns project and goal wire shapes,
while `@ega/contracts` owns the other mobile wire families. The API-client
methods and mobile adapters consume those local types, so a server/application
shape change can bypass the shared contract package. The response shapes match
the current Hono routes and application read models, making this a safe
authority move rather than a product behavior change.

### Today

`apps/server/src/routes/today.ts` returns `OperatorSnapshotDto` and
`packages/api-client/src/today.ts` already types `today.get` as that snapshot.
The old `MobileTodayResponse` in `packages/contracts/src/mobile.ts` omits
timezone, time-context, day-window, planned-today, focus, schedule, and signal
fields. `apps/mobile/types/today.ts` aliases the old name to
`OperatorSnapshotDto`, and one mobile integration fixture still satisfies the
old narrow shape. The contract must have one response authority: the
Operator snapshot returned by the route.

## Selected change boundary

1. Add dedicated `@ega/contracts` modules for Project and Goal DTOs, inputs,
   filters, and response envelopes.
2. Turn `@ega/api-client/src/types.ts` into a compatibility re-export barrel;
   keep its public subpath without retaining a second DTO definition.
3. Type the Project, Goal, and Today API methods from `@ega/contracts`.
4. Align the mobile Today adapter and integration fixture with the canonical
   Operator snapshot.
5. Add contract/API-client tests that compile representative response and
   request fixtures at the shared boundary.

No new endpoint, product screen, database owner, or generic transport
abstraction is authorized by this inventory.

## Implementation evidence

The selected boundary is implemented at `b89dd2c7` and lint-cleaned at the
verification snapshot `49481508`:

- `@ega/contracts/projects` and `@ega/contracts/goals` now own the Project and
  Goal request, read-model, and mutation-envelope shapes.
- `@ega/api-client/src/types.ts` remains available as a compatibility subpath
  but only re-exports those shared types; it no longer defines wire DTOs.
- Project and Goal Hono routes and API-client resources use the shared response
  types, including the `{ ok: true, values }` create envelope.
- `MobileTodayResponse` aliases the complete `OperatorSnapshotDto`, and the
  native Today adapter and integration fixture exercise the added snapshot
  fields (timezone, time context, day window, focus, schedule, and signals).
- Existing mobile Project and Goal API test doubles now use the same complete
  response envelopes as the live API-client methods.

Focused boundary evidence at the implementation snapshot:

| Check | Result |
| --- | --- |
| `contracts:typecheck` | PASS |
| `contracts:test` | PASS — 22 tests |
| `api-client:typecheck` | PASS |
| `api-client:test` | PASS — 47 tests |
| `server:typecheck` | PASS |
| `server:test` | PASS — 128 tests |
| `mobile:typecheck` | PASS |
| `mobile:test` | PASS — 38 suites / 238 tests |
| architecture tests | PASS — 21 tests |
| purity/security checks | PASS |
| Android bundle export | PASS — exact Wave 03 implementation snapshot |
| changed-path lint | PASS — exact verification snapshot |

`mobile:doctor` remains NOT VERIFIED in this worktree because the shared
install currently hoists `@types/react` 19.2.14 while Expo declares
`~19.1.0`; the source package declares the compatible range and this is an
environment/install-state finding, not a contract change. No generated
dependency files are part of the wave.

## Wave ruling

**Wave 03 — ACCEPTED — EXTERNAL EVIDENCE NOT AVAILABLE.**

Code and boundary behavior are proven by the focused and affected suites.
Authenticated deployed API behavior, cross-user RLS isolation, and Android
runtime API connectivity remain `RUNTIME NOT VERIFIED`.

## Evidence still unavailable

No deployed authenticated Hono request, cross-user RLS check, or Android
runtime API request is available in this environment. Those remain
`NOT_RUNTIME_VERIFIED` for Wave 03 and downstream waves.
