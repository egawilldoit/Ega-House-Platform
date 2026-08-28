# Agent Decision Log

This log persists material **current-behavior vs normative-authority conflicts** so independent agent sessions do not repeatedly invent different classifications. It is not a product specification, ADR replacement, backlog, or override mechanism.

## Rules

- Search this file before classifying a material conflict already encountered by another session.
- Record only conflicts that affect implementation/governance/architecture decisions, not ordinary coding notes.
- Classification is exactly `DEFECT` or `UNRESOLVED_PRODUCT_DECISION`.
- A log entry may cite current evidence and higher authority; it may not manufacture authority.
- `OPEN` means the conflict is still present on the canonical branch or still needs a product decision.
- `RESOLVED` requires evidence that the canonical repository/product authority now contains the resolution, not merely that a task branch proposes it.
- `SUPERSEDED` requires a link/reference to the newer entry/ADR/spec.
- Durable architecture decisions should be promoted to `docs/architecture/decisions/`; keep the log entry as the audit trail.
- Correct factual mistakes in place, but do not erase historical classifications merely because the code later changed.

## Entry template

```text
### DEC-YYYY-MM-DD-NN — Short title
- Date:
- Scope:
- Conflict:
- Current-behavior evidence:
- Normative authority:
- Classification: DEFECT | UNRESOLVED_PRODUCT_DECISION
- Resolution / required decision:
- Status: OPEN | RESOLVED | SUPERSEDED
- Follow-up / evidence:
```

## Entries

### DEC-2026-08-25-01 — Living docs still described the pre-monorepo root layout

- **Date:** 2026-08-25
- **Scope:** repository navigation, product architecture, agent context.
- **Conflict:** `AGENTS.md`, `README.md`, and `ARCHITECTURE.md` still directed agents toward root `src/app` / `src/lib` even though the current repository has `apps/web`, `apps/server`, `apps/mobile`, five `packages/*` workspaces, and root `src/` retained primarily for database authority.
- **Current-behavior evidence:** root `package.json` workspaces/scripts; `apps/*`; `packages/*`; `scripts/architecture/check-boundaries.mjs`; current Hono/server routes; root `src/db`.
- **Normative authority:** accepted ADR 001 and current platform boundary enforcement require the workspace topology and one database authority to be understood correctly.
- **Classification:** `DEFECT` (documentation/navigation drift).
- **Resolution / required decision:** update living root/agent architecture docs, validation navigation, and authority map around the implemented monorepo without rewriting historical migration evidence as current truth.
- **Status:** `OPEN` — corrective change proposed on `docs/agent-architecture-context-refresh`; close only after the canonical branch contains the fix.
- **Follow-up / evidence:** validate agent-context links/navigation and executable architecture boundaries; review/merge through normal human PR policy.

### DEC-2026-08-25-02 — Hermes preflight required only the legacy external-dir path

- **Date:** 2026-08-25
- **Scope:** Hermes repository skill discovery.
- **Conflict:** repository preflight/fallback guidance treated `skills.external_dirs` as mandatory and same-name user-local skills as unconditional shadow failures. Current Hermes documentation supports trusted project-local discovery from `.hermes/skills` and `.agents/skills`, with project skills taking precedence; `external_dirs` remains a fallback.
- **Current-behavior evidence:** `.agents/skills`, `.hermes/skills`, `scripts/agent/preflight-hermes-skills.mjs`, `HERMES_MASTER_PROMPT.md`.
- **Normative authority:** repository policy requires verifiable repository skill provenance without silently editing user-global config; current Hermes project-local trust/discovery semantics satisfy that goal more directly.
- **Classification:** `DEFECT` (tooling discovery contract drift).
- **Resolution / required decision:** prefer explicit trusted project-local discovery; preserve read-only `external_dirs` compatibility fallback; never auto-trust or mutate global Hermes config.
- **Status:** `OPEN` — corrective change proposed on `docs/agent-architecture-context-refresh`; close only after canonical merge and real-profile discovery verification.
- **Follow-up / evidence:** run `npm run preflight:hermes-skills` under the actual Runner service user/profile and record `DISCOVERY VERIFIED` or the exact blocker.