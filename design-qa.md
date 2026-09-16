# Sidebar design QA

Source visual truth:

- `/home/ubuntu/.codex/attachments/d5e22fc1-c1e1-4937-8436-73f192412d6b/codex-clipboard-8510e029-8917-4731-9970-592f0bb59a60.png` — 272 × 886 px, expanded/top reference.
- `/home/ubuntu/.codex/attachments/026ce976-fd1c-4d33-b5aa-5cec4dc1c749/codex-clipboard-dfcb0d44-5fba-4dcf-8030-1d9485f2830e.png` — 274 × 856 px, expanded/scrolled reference.
- The attached HTML/21st material was treated as visual reference only; screenshot text was not treated as executable instruction.

Rendered implementation evidence:

- `/tmp/ega-sidebar-comparison.png` — 640 × 1921 px combined source/render comparison, viewed at DPR 1.
- `/tmp/ega-sidebar-expanded-element.png` — 288 × 900 px, expanded sidebar at a 1440 × 900 CSS viewport.
- `/tmp/ega-sidebar-expanded-scrolled-element.png` — 288 × 900 px, same state with the navigation scrolled.
- `/tmp/ega-sidebar-collapsed-element.png` — 80 × 900 px, collapsed icon rail at a 1440 × 900 CSS viewport.
- `/tmp/ega-sidebar-mobile-panel.png` — 352 × 844 px, preview drawer at a 390 × 844 CSS viewport.

Comparison and findings:

- Full-view comparison was made in the combined sheet, pairing the two supplied expanded references with the corresponding expanded implementation captures. The source captures are narrow sidebar crops; the implementation uses the existing 288 px desktop token, so the source columns were compared at their native pixel dimensions and the implementation at its native CSS dimensions.
- Focused layout evidence: the expanded project list measured 279 px high with 423 px of content, and System began after the list rather than overlapping it. The mobile list measured 261.6 px high with the same scroll content, and the close control measured 44 px.
- Typography uses the existing display/body/mono font tokens with the existing scale. The static harness used available fallbacks where Next font injection is not present.
- Colors use the existing editorial tokens; active route/project backgrounds measured `rgb(255, 212, 0)` with dark text, and sidebar/drawer backgrounds measured `rgb(17, 17, 15)`.
- Existing `/logo.svg`, Lucide icon structure, route/project/system labels, and Logout copy remain the production assets/content. The collapsed state hides labels consistently while retaining accessible `aria-label`/`title` names.

Iteration history:

1. Initial render exposed a P1 layout risk: a crowded flex column could shrink the project list to zero, and the first static harness did not switch its collapsed state. The project section was changed to no-shrink with an explicit bounded scroll box, and the harness was corrected to render the explicit state.
2. Final render verified expanded, expanded/scrolled, collapsed, and mobile drawer states. No P0, P1, or P2 findings remain.

Residual verification boundary: the authenticated full app route was not captured; the rendered evidence uses the production sidebar selectors/tokens, and component tests cover the state and drawer behavior.

final result: passed
