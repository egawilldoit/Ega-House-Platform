# Production dependency audit exceptions

Unified CI blocks every new or directly-owned **high/critical** npm advisory. This
file records the exceptions enforced by advisory source ID in
`scripts/ci/audit-production.mjs`, plus the remediation history.

Re-reviewed **2026-10-26**. There are currently **no active high/critical
production-audit exceptions**. Any high/critical advisory is blocking.

## Active exceptions

None.

Metro `0.83.8` removed the vulnerable `image-size` dependency from the
maintained `0.83.x` line by vendoring the reduced asset-dimension parser. EGA
House keeps Expo 54 / React Native 0.81.5 and aligns the Metro family to
`0.83.8` through workspace overrides instead of downgrading Expo or suppressing
the advisory.

## Remediated advisories

| Leaf package | Advisory | Remediation | Evidence |
| --- | --- | --- | --- |
| `image-size@1.2.1` | GHSA-w3rx-r6r6-pgpr, GHSA-5p2g-fcmc-qvqq | align the full Metro 0.83 family (`metro`, its 13 sibling packages, and `ob1`) to `0.83.8`; Metro 0.83.8 removed `image-size` and vendors a reduced parser that excludes the affected ICNS/JXL/HEIF handlers | lockfile contains no `image-size`; production audit has no image-size high leaf; no Expo/RN downgrade |
| `next` (direct, critical) | GHSA-p293-qw3h-jr36, GHSA-2xp9-vwfh-vxw4 (`>=16.0.0 <16.3.3`) | `next 16.2.12 -> 16.3.5` (non-major), owner-approved Next pin move; `eslint-config-next` and `@next/swc-linux-x64-gnu` moved with it | production audit `critical 1 -> 0`; `workspace-proofs` Next pin updated to 16.3.5 |
| `sharp` | GHSA-rgj7-g3m4-5g8c (`<0.35.4`, reached via `next`) | override `sharp 0.35.3 -> 0.35.4` (satisfies the `next`/`@next/*` range) | `npm audit` no longer lists `sharp` |
| `js-yaml` | GHSA-52cp-r559-cp3m, GHSA-5p4m-2wfm-xmqj, GHSA-2883-xcg3-v3hh (sources 1123911/1138115/1193726/1193727) | scoped overrides `js-yaml@^4 -> 4.3.2`, `js-yaml@^3 -> 3.15.2` (both within the parents' existing major ranges) | `npm audit` no longer lists `js-yaml` |
| `nanoid` | GHSA-2v37-7h3g-55p8 (source 1139427) | override `nanoid -> 3.3.18` (within the `^3.3.8` parent ranges) | `npm audit` no longer lists `nanoid` |
| `@xmldom/xmldom` | GHSA-6mj3-qw4j-hgrw, GHSA-w2rr-34g9-rvrj, GHSA-4w3w-2rp5-g8jm and related (new sources) | scoped overrides `@xmldom/xmldom@^0.9 -> 0.9.12`, `@xmldom/xmldom@^0.8 -> 0.8.15` | `npm audit` no longer lists `@xmldom/xmldom` |
| `fast-uri` | (previously excepted, source 1130720) | resolved by the existing `fast-uri -> 3.1.7` override; no longer surfaces in the production audit | `npm audit` no longer lists `fast-uri` |
| `next` (2026-10-26 advisories, direct critical/high) | GHSA-2464-fhr4-w9xw, GHSA-p3m5-59mp-jv5r, GHSA-673q-mjm6-r5xr (`>=16.0.0 <=16.4.0`) | `next 16.3.8 -> 16.4.3` (non-major); `eslint-config-next` and `@next/swc-linux-x64-gnu` moved with it | production audit high/critical `5 -> 0`; Next pin updated in `workspace-proofs` |
| `@sentry/nextjs` (direct, critical) | GHSA-mchm-gjx6-7h55 (`>=10.0.0-alpha.0 <10.75.2`) | `10.68.0 -> 10.76.2` (non-major) | production audit no longer lists `@sentry/nextjs` |
| `dompurify` | GHSA-cg2g-xh64-v4q7 (critical), GHSA-mrv2-3pqr-j5jr (high), plus related moderate/low sources | override `3.4.12 -> 3.4.17` (patched, reached via `posthog-js`) | production audit no longer lists `dompurify` |
| `undici` | GHSA-xjj6-f33q-929c (high), GHSA-4qv8-2p9j-2685 (moderate) | scoped override `undici@^6 -> 6.29.1` (reached via Expo CLI) | production audit no longer lists `undici` |
| `zod` | GHSA-mrhx-c7xc-m3w5 (`<4.6.6`) | removed the unused direct v3 dependency; moved `zod-v4` alias to `4.6.7`; MCP transitive resolution deduped to `4.6.7` | production audit no longer lists `zod`; web/MCP tests pass |

Remediation constraints honoured: **no breaking downgrades** and **no
`npm audit fix --force`**. The Metro move stays on the maintained `0.83.x`
line and keeps the complete Metro package family coherent at `0.83.8`.

`ws` is **not** excepted: the workspace overrides it to patched `8.21.3`, which is
compatible with the observed `^8.x` parent ranges. Hono is also **not** excepted:
the resolved Hono version is already above the affected advisory range.
Moderate-only findings remain visible in the audit JSON but do not satisfy the
high/critical blocking threshold.
