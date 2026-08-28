# Mobile App Agent Instructions

Scope: everything under `apps/mobile/`. These rules extend the repository-root [`AGENTS.md`](../../AGENTS.md).

## Role and structure

`apps/mobile` is the Expo / React Native product. Navigation is Expo Router under `app/`; reusable UI and mobile-only composition live beside it (`components/`, hooks/services/providers where present). Tests live under `__tests__/` and near feature code where established.

Read [`../../CONTEXT.md`](../../CONTEXT.md) for the Project → Goal → Task → Timer → Review model before changing workflow behavior.

## Boundary rules

- Mobile reaches product data through `@ega/api-client` and shared `@ega/contracts` over the authenticated `apps/server` transport.
- Do **not** import `@ega/application`, `@ega/data-access`, root `src/db`, `drizzle`, `apps/web`, or `apps/server` internals into mobile.
- Do not reproduce server authorization or persistence logic in the app. Mobile owns presentation, interaction, device state, and transport orchestration.
- Do not send a user id as authorization authority. Authentication credentials/session state must drive server identity.
- Keep native-only dependencies and Expo APIs inside the mobile workspace.
- When adding a shared wire capability, update contracts/API-client/server first or as one coherent cross-workspace change; do not create a mobile-only shadow contract.

## UI/navigation changes

- Preserve Expo Router route/layout conventions already present under `app/`.
- Reuse existing mobile components/tokens/patterns before adding another design system or parallel primitive set.
- Avoid web DOM assumptions (`window`, browser-only CSS/layout semantics) unless the code is explicitly web-targeted and guarded.
- Keep expensive work and network side effects out of render paths; use the existing state/effect/data-fetch pattern in the feature.

## Validation

From repository root:

```bash
npm run mobile:typecheck
npm run mobile:test
npm run mobile:doctor
npm run mobile:bundle
```

Use typecheck + affected tests during iteration. Run Doctor after dependency/native-config changes. Run bundle validation for routing, native dependency, Metro/config, or release-boundary changes.

For shared import/ownership changes also run:

```bash
npm run check:architecture
npm run test:architecture
npm run ci:purity
```

## Do not

- bypass the API boundary with direct database/application imports;
- duplicate server-side business rules locally as a second source of truth;
- add a new state/navigation architecture for one screen when an established pattern exists;
- claim Android/iOS runtime behavior from TypeScript tests alone.
