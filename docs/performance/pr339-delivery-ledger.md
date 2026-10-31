# PR #339 Delivery Ledger (perf/workspace-shell-persistent)
Branch: perf/workspace-shell-persistent
PR: https://github.com/egawilldoit/Ega-House-Platform/pull/339
Lead checkout: /home/ubuntu/ega-house-worktree
Last head before orchestration: 18363c224230b1ab7629a53275b38eb43936eb59
Model constraint: only iceman-contributor-free on OpenCode 2 (verified exact model ID required)

| Task | Owner | Status | Commit | Notes |
|------|-------|--------|--------|-------|
| W1 | subagent(iceman-contributor-free) | done | 9c318429 | single persistent shell, no nested AppShell |
| W2 | subagent(iceman-contributor-free) | done | 5b89a8ae | imports/actions restored |
| W3 | subagent(iceman-contributor-free) | done | 0435725c | E2E shell tests added |
| W4 | subagent(iceman-contributor-free) | done | 32f697ed | realtime overlap preserved |

| Task | Owner | Status | Commit | Notes |
|------|-------|--------|--------|-------|
| Merge main | lead | done | 9bf814ca | resolved conflicts, vercel regions dub1 preserved |
| A Review CSV | subagent(iceman-contributor-free) | done | 7f59652b | fixed href, added tests |
| E2E rewrite | subagent(iceman-contributor-free) | done | f04be35e | comprehensive tests added |

| Task | Owner | Status | Commit | Notes |
|------|-------|--------|--------|-------|
| W5 Home | subagent(iceman-contributor-free) | done | 630b4233 | primary action non-blocking |
| W6 Today | subagent(iceman-contributor-free) | done | 1735343e | drawer parallelized |
| W7 Tasks | subagent(iceman-contributor-free) | done | d0248b83 | drawer optimized |

| Task | Owner | Status | Commit | Notes |
|------|-------|--------|--------|-------|
| W9 Timer | subagent(iceman-contributor-free) | done | 7b6e56aa | isolated ticks, bounded history |
| W10 Nav | subagent(iceman-contributor-free) | done | (see W9 batch) | canonical nav preserved |
| W12 | subagent(iceman-contributor-free) | done | e6d37881/docs+scripts | post-Dublin measurements, limits recorded, no 50% CPU claim |
