# EGA House Repository Agent Contract

This is the repository-wide contract for coding agents. Keep it compact. Rules that only apply to one app or subsystem live in the nearest nested `AGENTS.md` and override this file only inside that directory tree.

## 1. Instruction scope and precedence

Before editing any file, discover the applicable instruction chain from repository root to that file. Read every `AGENTS.md` on that path; the deepest file owns local conventions when it is more specific.

Direct user/system instructions outrank repository guidance. Within repository guidance:

1. this root contract defines cross-repository safety and authority;
2. nested `AGENTS.md` files define local architecture, examples, pitfalls, and validation;
3. architecture/product documents provide deeper context but do not silently override higher normative authority.

Do not create duplicate copies of this contract in tool-specific configuration.

## 2. First five minutes

1. Confirm repository, branch, HEAD, worktree, and working-tree state. Never destroy unrelated local work.
2. Never implement directly on `main`. Use an authorized branch/worktree.
3. Read [`CONTEXT.md`](CONTEXT.md) for product/domain behavior.
4. Read the nearest nested `AGENTS.md` for every path you expect to touch.
5. Read the relevant architecture source from [`docs/architecture/`](docs/architecture/) before moving ownership or crossing a package boundary.
6. Search [`docs/agent-context/decision-log.md`](docs/agent-context/decision-log.md) before re-classifying a known code-vs-policy conflict.
7. Choose the narrowest existing validation that can prove the intended change.

## 3. Evidence and authority

Keep **current behavior** separate from **required behavior**.

### Current behavior evidence, strongest first

1. source code and checked-in configuration;
2. schema and migrations;
3. executable tests and CI guardrails;
4. observed runtime/configuration evidence;
5. living architecture/context documentation;
6. historical plans, audits, inventories, and reports.

### Required behavior authority, strongest first

1. explicit current product/user direction;
2. [`CONTEXT.md`](CONTEXT.md) and accepted product contracts;
3. authorized issue/acceptance criteria;
4. accepted ADRs and architecture policy;
5. repository guidance.

When the two disagree, do not rewrite one to match the other. Classify the gap as a **defect** or **unresolved product decision** and record a durable classification in [`docs/agent-context/decision-log.md`](docs/agent-context/decision-log.md) when the task authorizes governance/docs changes.

The decision log records prior reasoning; it never becomes higher authority than the sources above.

## 4. Non-negotiable safety invariants

- Never implement on `main`, force-push `main`, or merge a PR unless the user explicitly authorizes the merge.
- Preserve Runner queue direction: `pgmq.read()` → lease/claim → classify outcome → `pgmq.archive()` only after the correct terminal condition. Never introduce executable `pgmq.pop()` consumption.
- Never treat an agent/model/Hermes exit code, text, or JSON as proof that implementation succeeded. Repository and GitHub evidence must independently prove completion.
- Slack is reporting-only. Slack state is not delivery authority, merge authority, or completion proof.
- Never expose, commit, log, or copy secrets/tokens/credentials into source, fixtures, prompts, reports, or comments.
- Do not mutate production databases, deployment state, external accounts, secrets, or irreversible infrastructure without explicit authorization.
- Schema changes and migrations are separate actions. Do not equate editing schema code with applying a migration.
- Preserve authenticated identity boundaries. Never accept a caller-selected user id when the canonical path derives identity from verified authentication.
- Do not weaken tests, architecture checks, authorization, or queue/worktree safety merely to make validation green.

## 5. Current repository map

EGA House is an npm workspace monorepo.

| Area | Canonical responsibility | Local instructions |
|---|---|---|
| `apps/web` | Next.js web product, server components/actions, compatibility web APIs | [`apps/web/AGENTS.md`](apps/web/AGENTS.md) |
| `apps/server` | Hono HTTP transport used by native/API clients | [`apps/server/AGENTS.md`](apps/server/AGENTS.md) |
| `apps/mobile` | Expo / React Native product | [`apps/mobile/AGENTS.md`](apps/mobile/AGENTS.md) |
| `packages/*` | shared contracts, domain, use cases, adapters, API client | [`packages/AGENTS.md`](packages/AGENTS.md) |
| `src/db` + `drizzle/` | root database schema/migration authority | this file + architecture docs |
| `scripts/ega-runner` | autonomous delivery control plane | [`scripts/ega-runner/AGENTS.md`](scripts/ega-runner/AGENTS.md) |
| `.agents/skills` | repository skills | [`docs/agent-context/skill-routing-evaluation.md`](docs/agent-context/skill-routing-evaluation.md) |

The living architecture map is [`ARCHITECTURE.md`](ARCHITECTURE.md). The platform dependency model is [`docs/architecture/platform-monorepo.md`](docs/architecture/platform-monorepo.md).

## 6. Dependency direction

The intended product flow is:

```text
web server-side UI ─┐
                    ├─> application ─> domain/contracts
server transport ───┘          │
                               └─> repository ports ─> data-access

mobile ─> api-client ─> contracts ─> apps/server
```

Global rules:

- `domain` contains framework-independent domain rules.
- `application` owns use cases and ports; it must not become a web/server/mobile framework package.
- `data-access` implements persistence/integration adapters; it does not own product workflow policy.
- `contracts` owns shared wire/data contracts, not persistence or UI behavior.
- `api-client` is a client transport layer over contracts.
- Mobile must not import `application`, `data-access`, root DB modules, web internals, or server internals.
- Web server-side code may use application/data-access directly; do not add a self-HTTP hop to the Hono server just to reuse an endpoint.
- Transport/UI layers parse, authenticate, map, and present; durable workflow rules belong in domain/application modules.

If a proposed change reverses one of these arrows, stop and inspect the platform ADR/architecture before coding.

## 7. Working method

- Prefer the smallest coherent patch that changes the canonical owner once.
- Find existing callers, tests, exports, persistence, and compatibility surfaces before adding a new abstraction.
- Reuse established patterns in the same subsystem before inventing a parallel pattern.
- Do not clean up unrelated debt in the same patch.
- Do not rename/move public or operational surfaces solely because they appear unused; prove they are dead or explicitly authorize the removal.
- Update package exports/contracts when introducing a new public shared entry point.
- Add or update a regression test at the closest reliable seam for behavioral fixes.
- Treat generated files, lockfiles, migrations, snapshots, and native artifacts as intentional changes that require explanation.

## 8. Branch, worktree, commit, and PR discipline

- Start from the requested base; if none is specified, inspect repository/issue context rather than guessing.
- Use one task branch/worktree for one coherent task.
- Do not discard unrelated changes from an existing worktree.
- Inspect `git diff --check`, changed files, and status before committing.
- Use focused commits with descriptive conventional-style messages where practical.
- Opening/updating a PR is allowed when requested by the task. Merging remains a separate human/user authorization boundary.
- PR descriptions must distinguish observed evidence from assumptions and list validations actually run.

## 9. Validation strategy

Run the **narrowest relevant checks first**, then broader gates when the change crosses boundaries or before declaring a PR ready.

Common root commands:

```bash
npm run typecheck
npm test
npm run lint
npm run validate:agent-context
npm run check:architecture
npm run test:architecture
npm run ci:purity
npm run ci:security
npm run ci:workspace
npm run test:runner-loop
```

Each nested `AGENTS.md` lists its scoped commands. Prefer package scripts over direct tool-binary invocation so local evidence matches CI behavior.

For docs/governance-only changes, at minimum run agent-context validation and diff hygiene. For ownership/import changes, run architecture/purity checks. For security/auth changes, run security proofs plus affected tests. For Runner changes, run the Runner-specific contract.

Do not claim a command passed unless its output was observed for the exact commit/worktree being described. A parent commit's green CI is useful evidence, not exact-head proof.

## 10. Documentation and historical evidence

Living entry points:

- [`CONTEXT.md`](CONTEXT.md) — product mental model and vocabulary.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — current implementation map.
- [`docs/agent-context/index.md`](docs/agent-context/index.md) — agent context navigation.
- [`docs/agent-context/product-authority.md`](docs/agent-context/product-authority.md) — authority/evidence model.
- [`docs/agent-context/tooling-map.md`](docs/agent-context/tooling-map.md) — active harness/config discovery map.
- [`docs/agent-context/testing-and-validation.md`](docs/agent-context/testing-and-validation.md) — evidence/command matrix.
- [`docs/reports/README.md`](docs/reports/README.md) — historical report index.

Dated audits, migration inventories, design handoffs, readiness snapshots, and old branch reports are point-in-time evidence unless a living authority document explicitly adopts them.

## 11. Skills and tooling

Repository skills live under `.agents/skills`. Select the smallest skill whose trigger matches the task. Skills guide workflow; they do not outrank product authority or this safety contract.

Tool-specific config should contain hooks/plugins/discovery configuration only when needed. Do not fork repository governance into separate tool copies. See [`docs/agent-context/tooling-map.md`](docs/agent-context/tooling-map.md).

## 12. Completion contract

Before saying work is complete:

1. verify the final changed-file list and diff;
2. confirm the applicable root→leaf `AGENTS.md` chain was respected;
3. run and record the required scoped validations;
4. run broader architecture/security/agent-context gates when the change requires them;
5. confirm no secret, generated artifact, migration, or unrelated file slipped into the patch;
6. state what remains unverified;
7. leave merge/deploy/database execution to the required approval boundary.
