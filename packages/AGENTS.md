# Shared Packages Agent Instructions

Scope: `packages/`. This extends the root [`AGENTS.md`](../AGENTS.md).
Read [`../docs/architecture/platform-monorepo.md`](../docs/architecture/platform-monorepo.md)
and [`../docs/architecture/decisions/001-platform-monorepo.md`](../docs/architecture/decisions/001-platform-monorepo.md)
before changing ownership or dependency direction.

| Package | Owns | Does not own |
|---|---|---|
| `@ega/contracts` | shared DTO/wire validation | DB, UI, orchestration |
| `@ega/domain` | pure product rules/value behavior | HTTP, persistence, frameworks |
| `@ega/application` | use cases, ports, orchestration | handlers, concrete clients |
| `@ega/data-access` | persistence/integration adapters | workflow/UI/transport policy |
| `@ega/api-client` | typed HTTP over contracts | DB, use cases, UI state |

Put behavior in the lowest layer that can own it. Keep exports intentional,
avoid deep private imports/cycles, and update export/type/tests together. Do not
duplicate contracts or introduce an abstraction for hypothetical callers.

## Proof

Run the changed package’s typecheck and test:

```text
npm run contracts:typecheck
npm run contracts:test
npm run domain:typecheck
npm run domain:test
npm run application:typecheck
npm run application:test
npm run data-access:typecheck
npm run data-access:test
npm run api-client:typecheck
npm run api-client:test
```

Ownership, exports, or direction changes also require
`npm run check:architecture`, `npm run test:architecture`, and
`npm run ci:purity`; auth/RLS adapter changes require `npm run ci:security`.

A changed package's passing tests are not consumer proof. Trace affected public
exports, wire/error shapes, serialized data, and callers; run consumer checks
where semantics or interfaces change. For data/schema-sensitive behavior use real
disposable-database proofs of affected constraints, ownership, and transitions.
Keep deployment compatibility with existing clients/data explicit.
