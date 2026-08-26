# Skill-Routing Evaluation

This artifact defines expected routing boundaries for the six EGA House skills. It is a semantic expectation until a clean tool session is executed and recorded. Harness loading/provenance belongs in [`tooling-map.md`](tooling-map.md); this file only describes **which skill should be selected for which job**.

| Prompt | Expected skill | Skills that should not trigger initially | Reason | Observed |
|---|---|---|---|---|
| “Map why Runner can complete without a PR” | `code-truth-audit` | `issue-implementation` | Disputed architecture/current truth | NOT EXECUTED — runtime tool session not recorded |
| “The docs still say root `src/app`; reconcile them with the monorepo” | `code-truth-audit` | `issue-implementation` initially | Current-truth/architecture contradiction | NOT EXECUTED |
| “Implement EGA-412 exactly as specified” | `issue-implementation` | `code-truth-audit` unless contradictions emerge | Bounded implementation | NOT EXECUTED |
| “Why is run UUID X stuck?” | `delivery-run-diagnostics` | `code-review` | Runtime chronology | NOT EXECUTED |
| “Read the run and event rows for UUID X” | `database-evidence` | `issue-implementation` | Read-only persistence evidence | NOT EXECUTED |
| “Review PR #71 for regressions” | `code-review` | `final-verification` as the initial action | Proposed-diff review | NOT EXECUTED |
| “All changes are complete; verify before handoff” | `final-verification` | `issue-implementation` | Completion gate | NOT EXECUTED |
| “Fix a typo in README” | No specialized skill required | `code-truth-audit` | Small localized edit | NOT EXECUTED |

## Ambiguous prompts

| Prompt | Preferred resolution | Reason | Observed |
|---|---|---|---|
| “Fix why run UUID X never opened a PR” | Start with `delivery-run-diagnostics`; switch to `issue-implementation` only after a bounded defect and authorization are established | Runtime evidence must identify the real failing transition before editing | NOT EXECUTED |
| “Audit and fix the agent instructions” | Start with `code-truth-audit`; use `issue-implementation` only when the corrective patch is a separately bounded implementation contract | Repository truth and authority are disputed | NOT EXECUTED |
| “Mobile imported data-access; fix the architecture” | Start with `code-truth-audit` to prove the boundary violation, then bounded implementation once the defect/scope is established | Architecture classification precedes repair | NOT EXECUTED |
| “Review and certify PR #71” | `code-review` first; `final-verification` only after findings are resolved and evidence exists | Review and certification are separate phases | NOT EXECUTED |
| “Check database rows and tell me why the run failed” | `delivery-run-diagnostics`, using `database-evidence` as a bounded helper | Requested outcome is a cross-system timeline, not a table dump | NOT EXECUTED |

## Real-session procedure

When the relevant CLI/harness is available, use a fresh non-modifying session from the repository root and at least one nested working directory. Record installed version, CWD, loaded repository instructions, visible skill provenance, selected skill, and discrepancies. Replace `NOT EXECUTED` only with observed evidence from that session; writing this table alone does not prove semantic routing.