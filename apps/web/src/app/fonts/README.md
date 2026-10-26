# Self-hosted web fonts

`apps/web/src/app/layout.tsx` loads these files with `next/font/local`. Nothing in
the web production build reaches `fonts.googleapis.com` or `fonts.gstatic.com`,
so a locked-down or air-gapped build still compiles.

| File | Family | Axis | CSS variable |
| --- | --- | --- | --- |
| `instrument-sans-latin-var.woff2` | Instrument Sans | `wght 400 700` | `--font-body-next` |
| `sora-latin-var.woff2` | Sora | `wght 100 800` | `--font-display-next` |
| `jetbrains-mono-latin-var.woff2` | JetBrains Mono | `wght 100 800` | `--font-mono-next` |

Each file is the upstream *latin* subset variable font that the Google Fonts
CSS2 API serves for `subsets: ["latin"]`. `app/globals.css` keeps the same
family fallback stacks, so rendered typography is unchanged from the previous
`next/font/google` configuration.

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
taken from `google/fonts` (`ofl/<family>/OFL.txt`).

To refresh, re-download the same `latin` subset file for the family's weight
range and update this table if the version changes. Do not add a different
subset or a static instance without re-checking the CSS variable contract.
