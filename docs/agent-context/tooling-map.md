# Agent Tooling Map

**Last repository/vendor-doc review: 2026-08-25.**

Purpose: make tool-specific loading/provenance explicit without copying repository governance into every tool directory. Root [`../../AGENTS.md`](../../AGENTS.md) remains the repository guidance source.

Evidence labels in this table describe what was inspected; they do not claim a live CLI session unless stated.

| Tool / layer | Repository config/source | How repository guidance is consumed | Independent rule copy? | Verification state |
|---|---|---|---|---|
| Codex | root `AGENTS.md`; `.codex/hooks.json` contains Graphify pre-tool hook only | Codex discovers scoped `AGENTS.md`/override files; repository validator models the instruction chain/byte budget | No | REPO-MODELED + OFFICIAL-DOC-VERIFIED; live installed-profile selection is runtime evidence |
| Claude Code | `CLAUDE.md` → `@AGENTS.md` | One-line delegation keeps Claude on root governance | No | REPO-CONFIGURED; live runtime loading not asserted here |
| OpenCode V2 | root `AGENTS.md`; `.opencode/opencode.json` registers Graphify plugin | Current V2 discovers `AGENTS.md` from location toward project root | No | OFFICIAL-DOC-VERIFIED; current repo config has no competing instructions |
| Hermes | `.agents/skills`, `.hermes/skills`, `HERMES_MASTER_PROMPT.md`, preflight script | Preferred: explicitly trusted project-local skills; fallback: configured external dir. Master prompt tells Hermes to read root governance/context | No product-rule copy; compact fallback only | OFFICIAL-DOC-VERIFIED + PREFLIGHT AVAILABLE; actual Runner profile must be tested |
| Shared EGA skills | `.agents/skills/*/SKILL.md` | Small trigger/procedure docs link back to product authority rather than restating it | No | STRUCTURALLY VALIDATED by `npm run validate:agent-context` |
| Generic agent skills | `.agents/*`, `.opencode/skills`, `.hermes/skills`, `.pi/agent/skills` | Capability/workflow helpers only; they must not override repository product authority | Must not | Presence is repository evidence; per-tool runtime selection varies |
| Pi / Graphify helper | `.pi/agent/skills/graphify`; Graphify hook/plugin wiring elsewhere | Auxiliary code-graph/tooling support | No repository governance file proven here | RUNTIME NOT VERIFIED for automatic AGENTS loading; explicitly read root governance when using this harness |

## Tool-specific notes

### Codex

The repository intentionally keeps one root `AGENTS.md`. `scripts/agent/validate-agent-context.mjs` models Codex discovery for root, mobile, Runner, and web working directories and enforces the configured/default instruction-byte budget. This is structural modeling, not evidence that a particular installed Codex build actually loaded the chain.

Official reference: https://openai.com/index/unrolling-the-codex-agent-loop/

### OpenCode V2

Current V2 documentation says project `AGENTS.md` is the active persistent instruction mechanism. Although the V2 config schema accepts an `instructions` array, the current V2 documentation says those entries are parsed but not resolved into instruction sources. Therefore this repository should **not** add a second `instructions` copy of `AGENTS.md` merely for symmetry.

Official reference: https://opencode.ai/v2/docs/instructions

### Claude Code

`CLAUDE.md` is deliberately one line:

```text
@AGENTS.md
```

Do not expand it into an independent policy file. Any Claude-specific behavior that cannot live in root governance should be narrowly scoped and documented here before adding another instruction source.

### Hermes

Current Hermes documentation supports project-local skills from `.hermes/skills` and `.agents/skills`. Project-local skills require explicit project trust and have precedence over user-local/external skills. `skills.external_dirs` remains supported and is useful as a compatibility fallback.

Official reference: https://hermes-agent.nousresearch.com/docs/user-guide/features/skills/

Repository policy for Hermes:

1. Prefer project-local `.agents/skills` when the project is explicitly trusted by the operator/profile.
2. Never run `hermes skills trust` or mutate `~/.hermes/config.yaml` without explicit authorization.
3. Allow the existing external-dir approach as fallback.
4. Under project-local discovery, same-name user-local skills do not outrank project skills. Under external-dir fallback, user-local same-name skills can shadow repository skills and must be treated as provenance failure.
5. Run `npm run preflight:hermes-skills` under the actual Runner service user/profile before relying on repository skills.

## Drift policy

- Tool configs may register hooks/plugins/models/permissions, but repository product/safety rules should stay in `AGENTS.md` + linked living docs.
- If a tool cannot consume root governance, record the exception here and create the smallest pointer/fallback possible rather than copying the full policy.
- Vendor documentation is time-sensitive. Update the “last review” date only after re-checking the current tool behavior.
- A successful structural check is not a semantic-routing test. Runtime discovery results belong in the task/PR evidence and may update [`skill-routing-evaluation.md`](skill-routing-evaluation.md).