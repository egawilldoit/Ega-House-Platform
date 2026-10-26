# Self-hosted web fonts

`apps/web/src/app/layout.tsx` loads these files with `next/font/local`. Nothing in
the web production build reaches `fonts.googleapis.com` or `fonts.gstatic.com`,
so a locked-down or air-gapped build still compiles.

| File | Family | Declared weight | File axis | CSS variable |
| --- | --- | --- | --- | --- |
| `instrument-sans-latin-var.woff2` | Instrument Sans | `400 700` | `wght 400 700` | `--font-body-next` |
| `sora-latin-var.woff2` | Sora | `100 800` | `wght 100 800` | `--font-display-next` |
| `jetbrains-mono-latin-var.woff2` | JetBrains Mono | `400 600` | `wght 100 800` | `--font-mono-next` |

`Declared weight` is the `@font-face` descriptor emitted by `layout.tsx`;
`File axis` is what the binary actually supports. Mono is declared `400 600`
on purpose: the mono faces the design system previously used were 400/500/600,
so a `font-weight: 900` mono label still clamps to the 600 master.

## Coverage (deliberate reduction)

Each file is the upstream **latin subset** variable font that the Google Fonts
CSS2 API returns for `<family>:wght@<range>`.

The previous `next/font/google` configuration did **not** restrict subsets — its
`subsets: ["latin"]` option only controls *preloading*, and the loader emitted
every `@font-face` Google returned. The old build therefore also had latin-ext
(Instrument Sans, Sora, JetBrains Mono) and, for JetBrains Mono, cyrillic /
greek / vietnamese faces.

`next/font/local` cannot attach a `unicode-range` to an individual `src` entry,
so re-declaring every subset would create duplicate faces with identical
descriptors and the browser would only use one. Shipping latin-only is the
explicit scope decision here:

- Latin-1 (U+0000–00FF) accents and Latin punctuation still render in the brand
  family — that covers the English product UI and the pages the ticket asks to
  compare (`/today`, `/tasks`, `/home`).
- Text containing Central/Eastern European (latin-ext), Cyrillic, Greek or
  Vietnamese characters now falls back to the `globals.css` system stack
  instead of the brand family. This affects user-authored content only; no
  product string currently uses those ranges.
- Restoring full coverage means either a full (non-subset) WOFF2 per family or
  reintroducing subset `@font-face` blocks outside `next/font/local`. Both are
  larger changes than this build-reproducibility fix and are not done here.

## Weight resolution

Weights that have no exact master now resolve on the variable axis instead of
being quantised to the nearest declared face. For example `font-weight: 450`
and `550` in `apps/web/src/styles/workspace.css` used to snap to the 500 and
600 masters; they now render at 450 and 550, which is what those declarations
ask for. Hierarchy and computed weights are unchanged; only the substituted
master differs by up to 50 units.

## Licence

All three families are licensed under the SIL Open Font License 1.1. The
upstream licence text ships next to the binaries:

- `OFL-instrument-sans.txt` — Copyright 2022 The Instrument Sans Project Authors
  (<https://github.com/Instrument/instrument-sans>)
- `OFL-sora.txt` — Copyright 2019 The Sora Project Authors
  (<https://github.com/sora-xor/sora-font>)
- `OFL-jetbrains-mono.txt` — Copyright 2020 The JetBrains Mono Project Authors
  (<https://github.com/JetBrains/JetBrainsMono>)

## Provenance

Retrieved 2026-10-26 from the Google Fonts CSS2 API
(`https://fonts.googleapis.com/css2?family=<family>:wght@<range>&display=swap`)
and the `src` URLs it returned on `fonts.gstatic.com`. The full OFL texts were
taken from `google/fonts` (`ofl/<family>/OFL.txt`), with upstream trailing
whitespace removed so the repository diff-hygiene gate stays clean; the licence
wording is unchanged.

To refresh, re-download the same `latin` subset file for the family's weight
range and update this table if the version changes. Do not add a different
subset or a static instance without re-checking the CSS variable contract.
