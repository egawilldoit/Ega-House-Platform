# Homepage Scrollytelling Polish Design

**Date:** 2026-08-03
**Branch:** `feat/homepage-operational-studies`
**Status:** Approved

## Goal

Polish the existing six-study EGA House landing-page narrative without changing its concept, section order, authentication behavior, or approved light-to-dark art direction.

## Authoritative design sources

No root `DESIGN.md` exists on this branch. Reuse the established values from:

- `src/app/globals.css` for global fonts and application tokens;
- `src/app/home/home.css` for the route-scoped homepage palette and structural tokens;
- `src/app/home/home-polish.css` for normal-zoom and responsive refinements;
- the previously approved operational-studies design specification.

Do not introduce new colors, font families, animation libraries, spacing systems, or arbitrary type-size endpoints.

## Root causes

1. Sections use fixed viewport-oriented minimum heights together with `overflow: hidden`, allowing tall compositions to be clipped.
2. Headline selectors use `overflow-wrap: anywhere`, which permits mid-word breaks.
3. The three-column fixed header does not explicitly protect the right action from shrinking, wrapping, or touching the safe edge.
4. The Section 00 and Section 05 numerals are absolutely positioned decorations without a visible caption or grid anchor.
5. Section 00 vertically centers a large three-line heading, body copy, CTAs, rule, and index inside a viewport-height composition.
6. Timer metadata uses micro-copy sizing and partially transparent cream text inside the most visually dense part of the widget.

## Approved changes

### Shared layout safeguards

- Keep native page scrolling authoritative.
- Let each study grow beyond one viewport when required.
- Use horizontal clipping only; do not clip vertical section content.
- Preserve existing section palettes and visible grid backgrounds.
- Add explicit 1440px, 1024px, and 390px-safe layout rules using the existing responsive architecture.

### Headline behavior

All six section headings must use:

- `text-wrap: balance`;
- `overflow-wrap: normal`;
- `word-break: normal`;
- `hyphens: none`.

No word may split between lines. Existing authored line wrappers remain authoritative.

### Section 00

- Top-align the copy inside the safe content area.
- Reduce and reposition the existing `EGA` mark using existing display-scale endpoints.
- Dock the `00` numeral to the mark's divider and pair it with the existing `Introduction` label.
- Keep the complete three-line headline, description, CTAs, and operating-loop index visible without vertical clipping.

### Section 03

- Widen the focus copy column and use the established Review-scale upper endpoint for the focus headline.
- Keep `momentum.` intact.
- Let the section grow when the task block cannot fit within one viewport.
- Strengthen timer metadata using existing homepage body/micro-copy endpoints and established cream/citrus tokens.
- Preserve the timer value and orbital animation behavior.

### Header

- Use `auto minmax(0, 1fr) auto` columns.
- Add safe inline padding using the current spacing range.
- Apply `white-space: nowrap`, `min-width: max-content`, and safe alignment to the right action.
- Continue hiding the right action at the existing mobile breakpoint.

### Section 05

- Dock the large `05` numeral to the existing divider.
- Pair it with the existing `Workspace` label.
- Preserve the disc and final conversion hierarchy.

### Copy

The canonical signup CTA is `Create account` in both Section 00 and Section 05. `Enter workspace` remains unchanged.

No other tone or product-copy changes are authorized in this polish pass.

### Intermediate type hierarchy

Promote `.home-kicker` into the intermediate subhead tier using type sizes already present in the route and global design system. Do not create another font family or unrelated scale.

## Testing

Automated source contracts must verify:

- all six study headings receive no-mid-word-break safeguards;
- vertical content is not clipped;
- header right-action safeguards exist;
- Section 00 and Section 05 index numerals are paired with labels;
- signup CTA wording is exactly `Create account` in both conversion locations;
- 1440px, 1024px, and 390px breakpoint contracts exist;
- existing themes remain unchanged.

Run the focused homepage suite, full repository suite, TypeScript, scoped ESLint, production build, and both PR workflows. Inspect a fresh Vercel preview at 1440px, 1024px, and 390px before merge.

## Acceptance criteria

1. All six headlines are fully readable at 1440px, 1024px, and 390px widths.
2. No heading uses mid-word wrapping.
3. Both signup CTAs read `Create account`.
4. The `00` and `05` numerals are visually anchored and paired with labels.
5. The fixed header remains inside the safe viewport.
6. Focus task content and timer labels are readable and not vertically clipped.
7. The approved light-to-dark theme sequence and authentication links are unchanged.
