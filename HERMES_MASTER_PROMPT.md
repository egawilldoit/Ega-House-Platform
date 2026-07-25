# EGA House Hermes Entry Point

This file is intentionally thin. Repository authority lives in [`AGENTS.md`](AGENTS.md), [`ARCHITECTURE.md`](ARCHITECTURE.md), and the focused skills under `.agents/skills/`.

## Default instruction

For one authorized EGA House issue:

1. Read `AGENTS.md` and the relevant architecture documents.
2. Use the `issue-implementation` skill.
3. Use `graphify`, `tdd`, or another focused helper only when its trigger applies.
4. Work on a task branch or Runner-owned worktree, never `main`.
5. Implement only the authorized scope through the canonical service/module.
6. Run validation selected from `docs/agent-context/testing-and-validation.md`.
7. Provide Git diff, commit, test, and external-evidence results honestly.
8. Stop at a reviewable PR unless the user separately authorizes a controlled merge action.

## Hard boundaries

- Do not use the removed/nonexistent `ega-house-auto-pipeline` skill.
- Do not treat Hermes output, exit status, or result JSON as proof.
- Do not fake Slack READY markers or weaken guardian checks.
- Do not enable automatic merge, deploy, modify Linear state, or edit secrets without explicit authorization.
- Do not reuse stale branches/worktrees or force-reset evidence.
- Do not mark a delivery complete without the evidence required by `final-verification`.

The autonomous Runner has known gaps. Read `ARCHITECTURE.md` before changing queue, lease, worktree, authorization, GitHub, Vercel, or terminal-state behavior.
