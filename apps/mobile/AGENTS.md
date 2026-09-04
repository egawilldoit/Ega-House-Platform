# Mobile App Agent Instructions

Scope: `apps/mobile/`. This extends the root [`AGENTS.md`](../../AGENTS.md).

## Boundaries

Expo Router UI/navigation owns presentation, interaction, device state, and
transport orchestration. Product data goes through `@ega/api-client` and shared
`@ega/contracts` over authenticated `apps/server`.

- Never import `@ega/application`, `@ega/data-access`, root DB/Drizzle, web, or
  server internals. Do not reproduce authorization, persistence, or workflow
  policy locally, and never use a caller-supplied user ID as authority.
- For a new shared capability update contracts/API-client/server coherently; do
  not create a mobile-only shadow contract. Keep native dependencies/Expo APIs
  inside mobile.
- Preserve Expo Router layouts and existing components/tokens. Avoid web DOM
  assumptions, render-driven network effects, a second design system, or a
  second icon system. Keep mutation feedback and Android back/safe-area/keyboard
  behavior explicit.

## Proof

```text
npm run mobile:typecheck
npm run mobile:test
npm run mobile:doctor
npm run mobile:bundle
```

Use typecheck + affected tests during iteration; run Doctor/bundle for native,
routing, Metro, or release changes. Shared ownership changes also require
`npm run check:architecture`, `npm run test:architecture`, and
`npm run ci:purity`. Do not claim Android/iOS runtime from TypeScript tests.
