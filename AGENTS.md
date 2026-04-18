# EGA House Platform — Agent Guide

## Product focus

EGA House is an execution workspace built around one loop:

**Project → Goal → Task → Timer → Review**

When making product decisions, optimize for this loop first.
Prefer workflow depth and real usability over decorative UI.

## Route and shell rules

- Canonical workspace routes are `/dashboard`, `/tasks`, `/goals`, `/timer`, and `/review`
- Treat `/apps/*` as compatibility-only, not the primary product structure
- New workspace pages should fit the existing shell instead of creating parallel layouts
- Use the existing shell pattern for page eyebrow, title, description, and actions
- Do not add visible UI affordances that are not wired to real behavior

## Data and auth rules

- Use the existing Supabase SSR server client pattern for server-side reads and writes
- Respect current auth, middleware, protected routes, and protected subdomain behavior
- Never bypass row-level security assumptions in application code
- Prefer server-side scoped queries over client-side fetch-and-filter
- Treat ownership and visibility as database concerns first, UI concerns second

## Mutation rules

- Put mutations in server actions
- Keep actions close to their route or domain unless there is a clearly reusable shared helper
- Validate all inputs on the server even if the client already validates them
- After successful mutations, revalidate the smallest correct set of affected routes
- Reuse existing action flows before inventing new mutation paths

## Drizzle and schema rules

- Database schema lives in `src/db/schema.ts`
- Database column naming stays snake_case
- TypeScript field naming stays camelCase
- Schema changes must include the correct Drizzle migration flow
- Keep schema additions small, explicit, and compatible with existing data unless the task clearly requires a breaking migration
- Prefer nullable new fields first when evolving live workflow models

## File placement rules

- Route pages and route-local actions/forms belong under `src/app/...`
- Shared domain UI belongs under `src/components/<domain>/...`
- Shared low-level UI primitives belong under `src/components/ui/...`
- Shared server/client helpers belong under `src/lib/...`
- Do not create a new top-level pattern when an existing domain folder already fits

## UI implementation rules

- Match the current product language: compact, clear, operational, and premium
- Prefer additive improvements to existing surfaces over parallel replacement UIs
- Reuse existing visual tokens and patterns before introducing new ones
- Keep forms compact and practical
- Build for real usage first: loading states, empty states, inline validation, and success/error feedback are required
- If a feature is visible in the shell or top bar, it should do real work

## Workflow priorities and delivery bias

When choosing between multiple implementation options, prefer the one that improves:

1. daily execution
2. focus and timer flow
3. weekly review quality
4. dashboard actionability
5. shell trust and speed

Bias toward:
- quicker task capture
- better task planning
- tighter timer-task handoff
- stronger review autofill and persistence
- real search and command flows
- fewer placeholder affordances
- finishing one real flow over starting multiple partial ones
- replacing placeholder UI with working behavior before adding more surface area
- thinking through the workflow handoff when changing Tasks, Timer, Review, Dashboard, or Shell

## New feature rules

Before adding a new feature:
- check whether the capability should extend an existing route or shell surface first
- check whether the same outcome can be achieved by improving an existing action or component
- prefer shipping a narrow vertical slice that is actually usable
- do not leave half-wired UI behind

For feature work:
- make the happy path fast
- make validation clear
- make the state transitions obvious
- preserve current route and filter context where appropriate

## Default delivery style

When implementing:
- explain the smallest correct change
- keep files and logic easy to review
- preserve existing route and domain structure
- leave the codebase more coherent than you found it