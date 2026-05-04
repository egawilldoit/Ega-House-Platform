# EGA House Platform — Agent Guide

## Purpose

EGA House is an execution workspace built around:

**Project → Goal → Task → Timer → Review**

Optimize for real daily execution, not decorative UI or placeholder surfaces.

## How to work

- Work only in the app/package named by the task.
- Keep changes narrow, reviewable, and behavior-safe.
- Prefer existing patterns before adding abstractions.
- Do not refactor unrelated files.
- Do not add or upgrade dependencies unless explicitly asked.
- Do not weaken validation, auth, type safety, tests, or security to pass a task.
- Do not leave visible UI controls that are not wired to real behavior.
- If instructions conflict, the user prompt wins for the current task.

## Repo map

- Web app: `src/app`, `src/components`, `src/lib`, `src/db`
- Mobile app: `apps/mobile`
- Web route pages/actions/forms: `src/app/...`
- Shared web domain UI: `src/components/<domain>/...`
- Shared UI primitives: `src/components/ui/...`
- Shared helpers: `src/lib/...`
- Database schema: `src/db/schema.ts`

## Web rules

- Canonical workspace routes: `/dashboard`, `/tasks`, `/goals`, `/timer`, `/review`.
- Treat `/apps/*` as compatibility-only unless explicitly requested.
- Use the existing shell pattern for page eyebrow, title, description, and actions.
- Use the existing Supabase SSR server client pattern for server-side reads/writes.
- Respect auth, middleware, protected routes, protected subdomains, and RLS assumptions.
- Prefer server-side scoped queries over client-side fetch-and-filter.
- Put mutations in server actions, validate inputs on the server, and revalidate the smallest correct route set.
- Drizzle schema columns stay `snake_case`; TypeScript fields stay `camelCase`.
- Schema changes require the correct Drizzle migration flow.

## Mobile rules

- The Expo React Native app lives under `apps/mobile`.
- Preserve route names, tab order, labels, auth/session behavior, and navigation behavior unless explicitly asked.
- Reuse existing mobile components, theme tokens, spacing, typography, and safe-area patterns.
- Respect Android home indicator/safe-area spacing.
- Avoid performance-heavy effects in repeated list items.
- Do not use real blur in repeated list content.
- Do not add full-width bottom bars behind floating navigation unless explicitly requested.
- For scroll/list screens, verify bottom padding plus loading, empty, error, disabled, and accessibility states.

## UI/product rules

- Match the product language: compact, clear, operational, premium.
- Prefer improving existing surfaces over replacement UIs.
- Build real workflow value first: task capture, planning, timer-task handoff, review quality, dashboard clarity, shell speed.
- Finish one narrow vertical slice before starting multiple partial ones.

## Validation

Run relevant commands from the package touched by the task.

Web, when available:
- `npm run typecheck`
- `npm test`
- `npm run build`

Mobile, from `apps/mobile`, when available:
- `npm run typecheck`
- `npm test`
- `npm run doctor`
- `npm run validate:bundle`

If a command is unavailable or fails, report the exact reason and whether it appears related to your change.

## Report format

End every task with:
1. Files changed.
2. Summary.
3. Validation commands and results.
4. Assumptions.
5. Follow-up tasks, if any.
