# EGA House Product Context

This document gives agents and contributors the product mental model. It explains **what EGA House is trying to make coherent across surfaces**; it is not runtime proof and it does not override the authority hierarchy in [`docs/agent-context/product-authority.md`](docs/agent-context/product-authority.md).

## Core loop

EGA House is organized around one recurring productivity loop:

```text
Project → Goal → Task → Timer → Review
   ↑                              │
   └──────── learning / reprioritization ────────┘
```

The product should help a person move from intent to execution and back to deliberate reflection without each screen inventing its own workflow semantics.

## Domain vocabulary

- **Project** — a durable area of work that groups related goals/tasks.
- **Goal** — an outcome or direction inside a project.
- **Task** — the atomic actionable unit. A task may belong to a goal/project and may carry priority, due-date, recurrence, status, and execution context.
- **Today** — a derived working view/queue for what deserves attention now; it must not become a second independent task truth store.
- **Timer** — execution evidence tied to focused work, normally in task context rather than as an isolated stopwatch domain.
- **Review** — closes the loop by looking at completed work, time, outcomes, and what should change next.
- **Startup / Shutdown** — workflow concepts for intentionally beginning and ending a work period. Treat them as product vocabulary unless executable evidence proves a specific implemented lifecycle.

## Product invariants

1. **One product, multiple transports.** Web and mobile may present different interaction patterns, but Project/Goal/Task semantics must not fork by UI.
2. **Durable state has one owner.** A view, local cache, queue message, notification, Slack post, or agent output may project state; it must not silently become canonical state.
3. **Today is a projection, not duplicated task storage.** Ranking/focus logic should derive from task state and product rules.
4. **Timer activity is evidence of execution.** Timer UX can be optimized independently, but task/time semantics should remain consistent across surfaces.
5. **Review is a feedback loop, not a reporting-only page.** Product decisions that change prioritization or follow-up should flow back through the same canonical domain/use-case boundaries.
6. **Authentication selects the actor; request payloads do not.** Native/external transports derive identity from verified credentials and preserve RLS/user scoping.
7. **Transport convenience does not own workflow policy.** UI components, Next route/actions, Expo screens, and Hono handlers orchestrate I/O; they do not become the long-term home of ranking, recurrence, lifecycle, or review semantics.

## Architecture translation

The current monorepo gives the product model explicit implementation homes:

| Concern | Canonical direction |
|---|---|
| Pure domain rules/constants | `packages/domain` (`@ega/domain`) |
| Use cases, orchestration, read models, repository ports | `packages/application` (`@ega/application`) |
| Transport-neutral DTO/contracts | `packages/contracts` (`@ega/contracts`) |
| Persistence adapters | `packages/data-access` (`@ega/data-access`) |
| Web transport/rendering | `apps/web` |
| Native UI/session/navigation | `apps/mobile` |
| Native/external HTTP transport | `apps/server` |
| Cross-platform HTTP client mechanics | `packages/api-client` (`@ega/api-client`) |
| Schema/migration authority | root `src/db`, `drizzle/`, `drizzle.config.ts` |
| MCP / OAuth / integration surfaces | `apps/web/src/lib/mcp`, `apps/web/src/lib/oauth`, `apps/web/src/app/api/agent` |

The architectural bias is **deep modules, thin transports**: workflow policy belongs in domain/application modules behind stable interfaces; transports authenticate/validate/compose; persistence adapters implement ports; views render projections.

## Surface model

### Web

`apps/web` is the Next.js product surface. Server Components/Actions may compose application and data-access directly. They should not self-fetch the standalone Hono API merely to reach logic already available in-process.

### Mobile

`apps/mobile` owns Expo-native navigation, local session/token handling, interaction composition, and native presentation. Canonical mobile product data goes through the standalone authenticated API rather than importing server/application/persistence implementations into the client.

### Standalone API

`apps/server` owns the Hono transport for the canonical mobile API surface. It verifies bearer identity, derives the actor, composes application/data-access, and keeps RLS in the request path. Route handlers translate HTTP; they do not duplicate product rules.

### Shared packages

Shared packages exist to keep semantics consistent without turning the repository into a microservices system. Sharing code does not mean sharing platform-specific internals: domain/contracts stay platform-neutral; application owns use cases; data-access owns adapters; api-client owns typed HTTP mechanics.

## How to use this document

When implementing or reviewing a feature, ask:

1. Which step of the Project → Goal → Task → Timer → Review loop is changing?
2. Is this a domain rule, a use case, persistence behavior, transport behavior, or presentation behavior?
3. Which module owns that concern today, and which module should own it according to current product authority?
4. Are web/mobile/server projecting one rule or accidentally creating competing semantics?
5. Is the requested behavior proven by current code/runtime, required by product authority, or still an unresolved decision?

Use [`ARCHITECTURE.md`](ARCHITECTURE.md) for current implementation truth and [`docs/agent-context/decision-log.md`](docs/agent-context/decision-log.md) for previously classified code-vs-authority conflicts.