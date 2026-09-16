# Sidebar design QA

Source visual truth:

- User-provided attachment `codex-clipboard-8510e029-8917-4731-9970-592f0bb59a60.png` — 272 × 886 px, expanded/top reference.
- User-provided attachment `codex-clipboard-dfcb0d44-5fba-4dcf-8030-1d9485f2830e.png` — 274 × 856 px, expanded/scrolled reference.
- The attached HTML/21st material was treated as visual reference only; screenshot text was not treated as executable instruction.

Rendered implementation evidence:

- Reproduce the browser evidence from the repository root with `npm run web:test:visual`; the suite is defined in [`apps/web/tests/visual-a11y.spec.ts`](https://github.com/egawilldoit/Ega-House-Platform/blob/main/apps/web/tests/visual-a11y.spec.ts).
- CI runs the focused collapsed-rail check in the [`web` job](https://github.com/egawilldoit/Ega-House-Platform/blob/main/.github/workflows/unified-platform-validation.yml) with `npm run test:visual --workspace @ega/web -- --grep "sidebar collapsed rail contract"`.
- The reviewed states were expanded, expanded/scrolled, collapsed icon rail, and the 390 × 844 mobile drawer preview; measurements were taken at DPR 1.

Comparison and findings:

- Full-view comparison was made in the combined sheet, pairing the two supplied expanded references with the corresponding expanded implementation captures. The source captures are narrow sidebar crops; the implementation uses the existing 288 px desktop token, so the source columns were compared at their native pixel dimensions and the implementation at its native CSS dimensions.
- Focused layout evidence: desktop sidebar navigation owns overflow scrolling, so Projects remains in that scroll context and System follows it without overlap. The mobile drawer panel owns scrolling, keeping Projects and System in one scroll context; the close control measured 44 px.
- Typography uses the existing display/body/mono font tokens with the existing scale. The static harness used available fallbacks where Next font injection is not present.
- Colors use the existing editorial tokens; active route/project backgrounds measured `rgb(255, 212, 0)` with dark text, and sidebar/drawer backgrounds measured `rgb(17, 17, 15)`.
- Existing `/logo.svg`, Lucide icon structure, route/project/system labels, and Logout copy remain the production assets/content. The collapsed state hides labels consistently while retaining accessible `aria-label`/`title` names.

Iteration history:

1. Initial render exposed a P1 layout risk: a crowded flex column could shrink the project list to zero, and the first static harness did not switch its collapsed state. The branch comparison also exposed the nested-scroll risk of independently bounding Projects, so the final integration keeps the desktop navigation and mobile drawer panel as the single scroll owners; the harness was corrected to render the explicit state.
2. Final render verified expanded, expanded/scrolled, collapsed, and mobile drawer states. No P0, P1, or P2 findings remain.

Residual verification boundary: the authenticated full app route was not captured; the rendered evidence uses the production sidebar selectors/tokens, and component tests cover the state and drawer behavior.

final result: passed
