# EGA House Repository Agent Contract
Compact contract. Nested `AGENTS.md` overrides locally.

## 1. Instruction scope and precedence
Read chain root→target; deepest `AGENTS.md` owns local conventions. Direct user/system instructions outrank repo guidance. Within repo: (1) root safety/authority, (2) nested `AGENTS.md` specialize, (3) architecture/product docs provide context.

## 2. First five minutes
1. Confirm repo/branch/HEAD/worktree/status.
2. Never implement on `main`.
3. Read [`CONTEXT.md`](CONTEXT.md).
4. Read nearest `AGENTS.md`.
5. Read relevant `docs/architecture/`.
6. Search [`docs/agent-context/decision-log.md`](docs/agent-context/decision-log.md).
7. Pick narrowest validation.

## 3. Evidence and authority
Separate current vs required.

**Current:** (1) code/config, (2) schema/migrations, (3) tests/CI, (4) observed runtime, (5) living docs, (6) historical.

**Required:** (1) explicit user/product direction, (2) [`CONTEXT.md`](CONTEXT.md) and contracts, (3) issue/criteria, (4) ADRs/architecture, (5) repo guidance.

Conflict => **defect** or **unresolved product decision** in [`docs/agent-context/decision-log.md`](docs/agent-context/decision-log.md). Also see [`docs/agent-context/tooling-map.md`](docs/agent-context/tooling-map.md).

## 4. Non-negotiable safety
- Never implement on `main`, force-push `main`, or merge without explicit auth.
- Never expose secrets.
- No production DB/deployment mutation without explicit auth.
- Schema edit != migration.
- Preserve authenticated identity (verified auth).
- Do not weaken tests/architecture/auth to make CI green.
- Model output never proves success.

## 5. Current repository map
| Area | Responsibility | Local instructions |
|---|---|---|
| `apps/web` | Next.js web, compat APIs (`/api/agent`, MCP) | [`apps/web/AGENTS.md`](apps/web/AGENTS.md) |
| `apps/server` | Hono transport | [`apps/server/AGENTS.md`](apps/server/AGENTS.md) |
| `apps/mobile` | Expo | [`apps/mobile/AGENTS.md`](apps/mobile/AGENTS.md) |
| `packages/*` | contracts/domain/app/data-access/api-client | [`packages/AGENTS.md`](packages/AGENTS.md) |
| `src/db`+`drizzle/` | DB authority | this file + arch docs |
| `.agents/skills` | skills | [`docs/agent-context/skill-routing-evaluation.md`](docs/agent-context/skill-routing-evaluation.md) |
Map: [`ARCHITECTURE.md`](ARCHITECTURE.md). Platform: [`docs/architecture/platform-monorepo.md`](docs/architecture/platform-monorepo.md).

## 6. Dependency direction
```text
web UI ─┐
        ├─> application ─> domain/contracts ─> data-access
server ─┘
mobile ─> api-client ─> contracts ─> apps/server
```
`domain` pure; `application` use cases/ports; `data-access` adapters; `contracts` DTOs; `api-client` transport; mobile never imports `application`/`data-access`/DB/web/server; web may use `application`/`data-access` directly.

## 7. Canonical-owner rule
Every durable behavior has one owner. Search callers/persistence/contracts/tests before creating logic.

## 8. Working method
Smallest patch; find callers/tests/exports; reuse pattern; no unrelated cleanup; prove dead before deleting; update exports; add test at closest seam.

## 9. AI / agent boundaries
LLM proposes; EGA validates; user approves where required. Agents/models cannot be state authority. Validate model output. No model mutates Task/Goal/Project unless validated path authorizes.

## 10. Branch/worktree/PR discipline
One task per branch/worktree; no unrelated mods; inspect diff/status; focused commits; PR allowed when requested; merge is human auth.

## 11. Validation
```bash
npm run validate:agent-context
npm run check:architecture
npm run ci:workspace
npm run typecheck
npm test
# see docs/agent-context/testing-and-validation.md
```
Do not claim pass unless observed for exact commit/worktree.

## 12. Completion contract
Verify diff, confirm AGENTS chain, run scoped validations, run broader gates when needed, confirm no secret/generated/unrelated file, state unverified, leave merge/deploy/DB to auth.
