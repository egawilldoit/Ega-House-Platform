# Skill-Routing Evaluation

This artifact defines expected routing boundaries for the six EGA House skills. It is a static expectation until a clean Codex/Hermes session is executed and recorded.

| Prompt | Expected skill | Skills that should not trigger initially | Reason | Observed |
|---|---|---|---|---|
| “Map why Runner can complete without a PR” | `code-truth-audit` | `issue-implementation` | Disputed architecture/current truth | NOT EXECUTED — Codex unavailable |
| “Implement EGA-412 exactly as specified” | `issue-implementation` | `code-truth-audit` unless contradictions emerge | Bounded implementation | NOT EXECUTED — Codex unavailable |
| “Why is run UUID X stuck?” | `delivery-run-diagnostics` | `code-review` | Runtime chronology | NOT EXECUTED — Codex unavailable |
| “Read the run and event rows for UUID X” | `database-evidence` | `issue-implementation` | Read-only persistence evidence | NOT EXECUTED — Codex unavailable |
| “Review PR #71 for regressions” | `code-review` | `final-verification` as the initial action | Proposed-diff review | NOT EXECUTED — Codex unavailable |
| “All changes are complete; verify before handoff” | `final-verification` | `issue-implementation` | Completion gate | NOT EXECUTED — Codex unavailable |
| “Fix a typo in README” | No specialized skill required | `code-truth-audit` | Small localized edit | NOT EXECUTED — Codex unavailable |

## Ambiguous prompts

| Prompt | Preferred resolution | Reason | Observed |
|---|---|---|---|
| “Fix why run UUID X never opened a PR” | Start with `delivery-run-diagnostics`; switch to `issue-implementation` only after a bounded defect and authorization are established | Runtime evidence must identify the real failing transition before editing | NOT EXECUTED |
| “Audit and fix the agent instructions” | Start with `code-truth-audit`, then use `issue-implementation` only for an authorized corrective patch | Repository truth and authority are disputed | NOT EXECUTED |
| “Review and certify PR #71” | `code-review` first; `final-verification` only after findings are resolved and evidence exists | Review and certification are separate phases | NOT EXECUTED |
| “Check database rows and tell me why the run failed” | `delivery-run-diagnostics`, using `database-evidence` as a bounded helper | The requested outcome is a cross-system timeline, not a table dump | NOT EXECUTED |

## Real-session commands

When Codex is available, run clean, non-modifying sessions from the repository root and `scripts/ega-runner`, record the installed version and actual selection, then replace `NOT EXECUTED` values with observed results. Writing this table alone does not prove semantic routing.
