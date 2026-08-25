# EGA House Hermes Entry Point

EGA House is a productivity platform with a monorepo product architecture and a partially implemented autonomous-delivery Runner. This file is a compact Hermes fallback/entry contract, not a replacement for [`AGENTS.md`](AGENTS.md), [`CONTEXT.md`](CONTEXT.md), [`docs/agent-context/product-authority.md`](docs/agent-context/product-authority.md), or [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Instruction loading

1. Read `AGENTS.md` first.
2. Read `CONTEXT.md` for product/domain work and the architecture documents relevant to the assigned issue; platform-boundary work must include `docs/architecture/platform-monorepo.md`.
3. Search `docs/agent-context/decision-log.md` for an existing classification of any code-vs-authority conflict encountered.
4. Attempt to load the repository `issue-implementation` skill for bounded implementation work; use the specialized skill whose trigger matches for audit/diagnostic/review work.
5. When repository skills are unavailable, follow the fallback workflow below and report discovery as unavailable rather than pretending it succeeded.
6. The Runner/VM profile must verify repository skill visibility with `npm run preflight:hermes-skills` under the same service user and environment.

## Repository skill discovery

Current Hermes supports trusted **project-local** skill discovery from both:

```text
<project-root>/.hermes/skills
<project-root>/.agents/skills
```

Project-local discovery is preferred because repository skills then have project precedence without duplicating them into the user profile. Trust is an explicit user/profile action; do not silently run a trust command or edit user-global configuration.

From inside the repository, an operator may explicitly authorize:

```bash
hermes skills trust
```

`skills.external_dirs` remains a supported compatibility fallback. When that fallback is used, point it at the absolute repository skill directory:

```yaml
skills:
  external_dirs:
    - /absolute/path/to/Ega-House-Platform/.agents/skills
```

Do not edit `~/.hermes/config.yaml` silently. With project-local discovery, project skills outrank user-local and external skills. With the external-dir fallback, a same-name user-local Hermes skill can shadow the repository skill and must be treated as failed repository provenance until reviewed.

## Authorized-issue boundary

- Work only on the assigned issue or explicit bounded contract.
- Work in the Runner-owned worktree or an approved task branch, never `main`.
- Modify only authorized product paths and repository-owned evidence paths.
- Do not select another issue, expand the backlog, or weaken approval gates.

## Minimal fallback workflow

When the required repository skill cannot be loaded:

1. Read the issue, acceptance criteria, authorized paths, `AGENTS.md`, `CONTEXT.md` when product semantics are involved, and the relevant architecture/ADR documents.
2. Trace the current canonical implementation and tests before editing.
3. Compare current behavior with normative product authority; report conflicts as defects or unresolved decisions and check the decision log before inventing a new classification.
4. Make the smallest coherent in-scope patch through the canonical module boundary.
5. Add or update a behavior-focused test/guardrail when a reliable seam exists.
6. Run the declared validation commands for every changed subsystem.
7. Write the required result artifact without secrets.

## Independent proof requirement

Hermes output, exit status, validation claims, and result JSON are candidate evidence only. The Runner must independently inspect actual changed paths, Git diff, commit ancestry, pushed SHA, PR/check state, and preview/runtime evidence required by the contract.

## External-write boundary

Do not merge, deploy, enable auto-merge, modify Linear workflow state, alter production data, edit secrets, trust repositories, or create unapproved external side effects. Stop at a reviewable implementation candidate unless a separate explicit authorization permits more.