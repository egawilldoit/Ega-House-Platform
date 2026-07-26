# EGA House Hermes Entry Point

EGA House is a productivity platform with a partially implemented autonomous-delivery Runner. This file is a compact repository fallback, not a replacement for [`AGENTS.md`](AGENTS.md), [`docs/agent-context/product-authority.md`](docs/agent-context/product-authority.md), or [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Instruction loading

1. Read `AGENTS.md` and the architecture documents relevant to the assigned issue.
2. Attempt to load the repository `issue-implementation` skill.
3. When repository skills are unavailable, follow the fallback workflow below and report skill discovery as unavailable rather than pretending it succeeded.
4. The Runner/VM profile must verify repository skill visibility with `npm run preflight:hermes-skills` under the same service user and environment.

Hermes external-skill configuration, when required, must point to the absolute repository path:

```yaml
skills:
  external_dirs:
    - /absolute/path/to/Ega-House-Platform/.agents/skills
```

Do not edit user-global Hermes configuration silently. A local Hermes skill with the same name shadows the external repository skill and must be treated as a failed preflight until reviewed.

## Authorized-issue boundary

- Work only on the assigned issue or explicit bounded contract.
- Work in the Runner-owned worktree or an approved task branch, never `main`.
- Modify only authorized product paths and repository-owned evidence paths.
- Do not select another issue, expand the backlog, or weaken approval gates.

## Minimal fallback workflow

When `issue-implementation` cannot be loaded:

1. Read the issue, acceptance criteria, authorized paths, `AGENTS.md`, and relevant architecture documents.
2. Trace the current canonical implementation and tests before editing.
3. Compare current behavior with normative product authority; report conflicts as defects or unresolved decisions.
4. Make the smallest coherent in-scope patch.
5. Add or update a behavior-focused test when a reliable seam exists.
6. Run the declared validation commands.
7. Write the required result artifact without secrets.

## Independent proof requirement

Hermes output, exit status, validation claims, and result JSON are candidate evidence only. The Runner must independently inspect actual changed paths, Git diff, commit ancestry, pushed SHA, PR/check state, and preview evidence required by the contract.

## External-write boundary

Do not merge, deploy, enable auto-merge, modify Linear workflow state, alter production data, edit secrets, or create unapproved external side effects. Stop at a reviewable implementation candidate unless a separate explicit authorization permits more.
