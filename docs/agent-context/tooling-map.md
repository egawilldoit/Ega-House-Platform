# Agent Tooling Map

**Status:** living repository-local map  
**Last verified:** 2026-08-25

The repository governance contract is `AGENTS.md` plus scoped nested `AGENTS.md` files. Tool configuration should discover or point to that contract; it should not carry an independent copy of repository policy.

## Active discovery/configuration

| Harness / mechanism | Repository path(s) | Governance behavior | Independent policy copy? |
|---|---|---|---|
| Codex-style project instructions | `AGENTS.md`, nested `*/AGENTS.md`, `.codex/` hooks/config where present | root→leaf instruction discovery; deeper file scopes local paths | No |
| OpenCode | `.opencode/`, root/nested `AGENTS.md` | repository config is for plugins/skills; repository governance stays in `AGENTS.md` | No |
| Hermes | `HERMES_MASTER_PROMPT.md`, `.hermes/skills`, `.agents/skills`, `scripts/agent/preflight-hermes-skills.mjs` | fallback entry prompt points to repository governance; project-local skills require the configured/trusted discovery path | No |
| Repository skills | `.agents/skills/*/SKILL.md`, `skills-lock.json` | workflow specializations selected by task trigger; never higher authority than repository/product policy | No |
| Graphify / Pi compatibility | `.pi/agent/skills/graphify`, mirrored Graphify skill locations | code-graph/helper capability only | No |

Tool-specific files may define hooks, plugins, skill discovery, transport, or runtime integration. They must not silently redefine branch policy, merge authority, product behavior, queue semantics, or validation truth.

## Scoped `AGENTS.md` layout

Current required instruction scopes:

```text
AGENTS.md
├── apps/web/AGENTS.md
├── apps/server/AGENTS.md
├── apps/mobile/AGENTS.md
├── packages/AGENTS.md
└── scripts/ega-runner/AGENTS.md
```

The root file owns repository-wide invariants. The leaf files own local architecture/pitfalls/commands. If a new subsystem becomes large or safety-critical enough to need materially different working rules, prefer another scoped `AGENTS.md` over growing the root file indefinitely.

Do not create nested files merely to repeat the root. A nested file must add local information that would otherwise burden every agent session.

## Drift controls

`npm run validate:agent-context` should prove at least:

- every required living context/instruction file exists;
- the root file links to product/context/architecture and scoped instruction entry points;
- local Markdown links resolve;
- skill frontmatter parses and required skills remain discoverable;
- no executable Runner `pgmq.pop()` call exists;
- the expected root→leaf instruction chain is selected for web, server, mobile, shared packages, and Runner workdirs;
- instruction bytes remain within the configured discovery budget.

A green structural validation proves file/discovery consistency. It does **not** prove semantic correctness, deployed behavior, external-tool configuration, or runtime success.

## Global/user configuration

User-global tool configuration is not repository authority and should not be edited silently. When a runtime requires explicit trust, external skill paths, credentials, or global configuration, report that requirement and let the authorized operator apply it.

Repository CI should validate what can be proven from the checkout; it should not pretend to inspect every developer's global agent configuration.

## Adding another harness

Prefer this order:

1. use its native `AGENTS.md` discovery when available;
2. otherwise add the smallest possible pointer/entry contract to `AGENTS.md`;
3. keep hooks/plugins/runtime configuration separate from governance text;
4. add structural validation for discovery if the harness becomes part of automated delivery;
5. never maintain a second full repository rulebook for a specific tool.
