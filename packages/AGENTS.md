# Shared Packages Agent Instructions

Scope: all workspaces under `packages/`. These rules extend the repository-root [`AGENTS.md`](../AGENTS.md).

Shared packages are architectural boundaries, not a dumping ground for code reused twice.

## Package ownership

| Package | Owns | Must not own |
|---|---|---|
| `@ega/contracts` | shared DTO/wire schemas and validation contracts | DB access, React/UI, product orchestration |
| `@ega/domain` | framework-independent domain rules/value behavior | HTTP, Supabase, React Native/Next.js |
| `@ega/application` | use cases, workflow orchestration, repository/service ports | framework handlers, concrete persistence clients |
| `@ega/data-access` | concrete persistence/integration adapters implementing application ports | product workflow authority, UI/transport behavior |
| `@ega/api-client` | typed external/native HTTP client over contracts | direct DB access, application use cases, UI state |

Read [`../docs/architecture/platform-monorepo.md`](../docs/architecture/platform-monorepo.md) and ADR [`../docs/architecture/decisions/001-platform-monorepo.md`](../docs/architecture/decisions/001-platform-monorepo.md) before reversing or widening a dependency.

## Design rules

- Put behavior in the lowest layer that can own it without importing infrastructure/framework concerns.
- `application` may depend on domain/contracts and define ports. It should not know Hono, Next.js, Expo, Supabase concrete clients, or Drizzle implementation details.
- `data-access` may implement application ports and use persistence SDKs, but it must not become the place where user workflow policy is decided.
- `api-client` should translate contracts to/from HTTP; it must not reimplement business rules from application/domain.
- Keep public package exports intentional. When adding a supported entry point, update `package.json#exports` and tests/types together.
- Do not deep-import another package's private `src/` internals to bypass its public API.
- Prefer package-local tests for package behavior; consumers should not be the only proof of a shared package.

## Validation

From repository root, use the package that changed:

```bash
npm run contracts:typecheck && npm run contracts:test
npm run domain:typecheck && npm run domain:test
npm run application:typecheck && npm run application:test
npm run data-access:typecheck && npm run data-access:test
npm run api-client:typecheck && npm run api-client:test
```

If dependency direction, exports, or ownership changed, also run:

```bash
npm run check:architecture
npm run test:architecture
npm run ci:purity
```

If a data-access change affects authentication/RLS assumptions, also run `npm run ci:security`.

## Do not

- create circular workspace dependencies;
- hide transport or framework objects inside shared domain/application types;
- duplicate contracts independently in client/server packages;
- put feature-specific UI helpers into a shared architectural package just to reduce imports;
- change a public export without checking its consumers.
