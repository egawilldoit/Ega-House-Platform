# EGA House Repository Agent Contract

This is the compact repository-wide contract. Direct user/system instructions
win; the nearest nested `AGENTS.md` adds more specific rules.

## Before editing

- Confirm repository, branch, HEAD, worktree, and dirty state. Never work on
  `main`; use one isolated branch/worktree per coherent task.
- Read [`CONTEXT.md`](CONTEXT.md), [`ARCHITECTURE.md`](ARCHITECTURE.md),
  [`docs/architecture/platform-monorepo.md`](docs/architecture/platform-monorepo.md),
  [`docs/agent-context/tooling-map.md`](docs/agent-context/tooling-map.md), relevant
  docs, and [`docs/agent-context/decision-log.md`](docs/agent-context/decision-log.md).
  Read the complete chain: [`apps/web/AGENTS.md`](apps/web/AGENTS.md),
  [`apps/server/AGENTS.md`](apps/server/AGENTS.md), [`apps/mobile/AGENTS.md`](apps/mobile/AGENTS.md),
  [`packages/AGENTS.md`](packages/AGENTS.md), and [`scripts/ega-runner/AGENTS.md`](scripts/ega-runner/AGENTS.md).
- Search/list first; find the nearest working pattern, callers, tests, exports,
  persistence, compatibility surfaces, and accepted plans before changing ownership.

## Authority and safety

Keep current behavior separate from required behavior. Prefer source/configuration,
schema/migrations, executable tests/CI, observed runtime, living docs, then
historical evidence. Required behavior comes from user/product direction,
`CONTEXT.md`/contracts, authorized criteria, ADRs, then guidance. Record
conflicts; do not silently rewrite evidence.

- Never merge, force-push `main`, deploy production, mutate production DB,
  rotate/delete credentials, or make destructive external changes without
  authorization. Never expose, log, commit, or copy secrets.
- Schema edits do not apply migrations. Preserve verified-auth identity,
  request-scoped Supabase/RLS, and owner isolation; never trust caller IDs or
  use service-role CRUD as a shortcut.
- Runner consumption is `pgmq.read()` → lease/claim → execute/classify → archive
  only at the defined terminal condition; never introduce executable
  `pgmq.pop()`. Hermes/agent output and Slack are not independent proof.

## Architecture

```text
web server-side ─┐
server transport ─┴─> application ─> domain/contracts
                         └─> ports ─> data-access ─> request-scoped RLS
mobile ─> api-client ─> contracts ─> Hono
```

Mobile must not import application, data-access, DB, web, or server internals.
Web server-side code composes application/data-access directly, not self-fetching
Hono. Durable policy belongs in domain/application; contracts own wire shapes;
api-client owns typed HTTP. Do not create a second schema, DTO, authority, or framework.

## Change and proof discipline

- Make the smallest coherent patch at the canonical owner; preserve public and
  operational compatibility until callers/removal safety are proven.
- Defects follow reproduce → trace → working comparison → one hypothesis → RED
  regression → minimal GREEN fix → targeted/related/runtime/broad verification.
  After three failed fixes, reassess architecture.
- Use focused commits. Before each, inspect staged content, `git status --short`,
  and `git diff --check`; justify generated files, lockfiles, migrations, and
  native artifacts.
- Publish only when safe. PRs target `main`, document base SHA and local range,
  remain unmerged, and claims require exact-head observed output.

## Validation and documentation

Run the narrowest relevant checks first, then affected architecture/security and
package gates. Common commands are:

```text
npm run typecheck
npm test
npm run lint
npm run check:architecture
npm run test:architecture
npm run ci:purity
npm run ci:security
npm run ci:workspace
npm run validate:agent-context
npm run test:ega-runner-pr-loop
```

Living docs must match current code/config/runtime and label `NOT VERIFIED`.
Historical reports remain historical. Before completion, review the exact changed
files/diff, applicable chain, tests, architecture/security gates, secrets and
generated artifacts, dirty state, and remaining unverified evidence. Leave merge,
production deployment, and production DB execution at their approval boundary.
