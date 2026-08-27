# Evidence — MCP v2 full read/write — 2026-08-28

**Branch:** `feat/mcp-v2-full-read-write`  
**Base SHA:** `1a01bf3d03bf2394358f204448d247f1b04d544e`

## W0 baseline — pending

- Repository/worktree truth: branch `feat/mcp-v2-full-read-write` at `/home/ubuntu/ega-house/.worktrees/mcp-v2-full-read-write`, HEAD 1a01bf3, origin/main same, clean worktree. Validated `git worktree add -b`.
- Instruction chain: root AGENTS.md → apps/web/AGENTS.md → packages/AGENTS.md
- Skills: `.agents/skills/{code-review,code-truth-audit,database-evidence,final-verification,tdd,grill-with-docs,issue-implementation}` plus frontend-design/next-best-practices
- Capability coverage: `docs/implementation/2026-08-28-mcp-capability-coverage.md`
- Design/spec/plan: `docs/superpowers/specs/2026-08-28-mcp-v2-full-read-write-design.md`, `docs/superpowers/plans/2026-08-28-mcp-v2-full-read-write.md`
- SDK delta vs 2026-07-28: `upgrade-to-v2.md` + `support-2026-07-28.md` analyzed; codemod `npx @modelcontextprotocol/codemod@latest v1-to-v2` plus manual `createMcpHandler`, `requestState` codec, header validation.
- Baseline validation: `npm run web:test` 1009 passed (1a01bf3), `npm run web:typecheck` pending exact head, `check:architecture` pending.

## Wave progress

| Wave | Linear | Status | SHA | Evidence |
|---|---|---|---|---|
| W0 baseline/design | EGA-530 | In Review pending commit | — | docs created, validation recorded |
| W1-2 SDK/transport | EGA-531 | Todo | — | — |
| W3 auth/grants | EGA-532 | Todo | — | — |
| W4 RLS | EGA-533 | Todo | — | — |
| W5 reads | EGA-534 | Todo | — | — |
| W6 writes | EGA-535 | Todo | — | — |
| W7 today/timer | EGA-536 | Todo | — | — |
| W8 MRTR | EGA-537 | Todo | — | — |
| W9 reliability | EGA-538 | Todo | — | — |
| W10 docs/ops | EGA-539 | Todo | — | — |
| W11 E2E/CI | EGA-540 | Todo | — | — |
| Audit #1 | EGA-541 | Todo | — | — |
| Audit #2 | EGA-542 | Todo | — | — |

## Next

Commit W0 docs, push, update L1 and parent, then W1 SDK migration.
