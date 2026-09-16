# Production dependency audit exceptions

Unified CI blocks every new or directly-owned **high/critical** npm advisory. This
file records the exceptions enforced by advisory source ID in
`scripts/ci/audit-production.mjs`, plus the remediation history.

Re-reviewed **2026-09-14** (Node 24.18.0 / npm 11.x). Exceptions must be
re-reviewed by **2026-09-28**. An exception is rejected automatically if its
vulnerable leaf becomes a direct dependency, if a different high/critical
advisory appears, or when the review deadline expires.

## Active exceptions

| Leaf package | Advisory | Classification | Proven path / constraint | Action |
| --- | --- | --- | --- | --- |
| `image-size@1.2.1` | GHSA-w3rx-r6r6-pgpr (source 1138808), GHSA-5p2g-fcmc-qvqq (source 1138809) | transitive Expo/Metro build toolchain | `expo@54 -> @expo/metro -> metro@0.83.x -> image-size@^1.0.2`; npm proposes only the breaking downgrade `expo@46`, which is refused | retain Expo 54 / RN 0.81.5 compatibility; re-evaluate when Metro/Expo publishes a compatible fixed `image-size`; do not use `npm audit fix --force` |

These are the only remaining high leaves. Every other high/critical advisory in
the resolved production graph was remediated or removed (below).

## Remediated on 2026-09-14 (exceptions removed)

| Leaf package | Advisory | Remediation | Evidence |
| --- | --- | --- | --- |
| `next` (direct, critical) | GHSA-p293-qw3h-jr36, GHSA-2xp9-vwfh-vxw4 (`>=16.0.0 <16.3.3`) | `next 16.2.12 -> 16.3.5` (non-major), owner-approved Next pin move; `eslint-config-next` and `@next/swc-linux-x64-gnu` moved with it | production audit `critical 1 -> 0`; `workspace-proofs` Next pin updated to 16.3.5 |
| `sharp` | GHSA-rgj7-g3m4-5g8c (`<0.35.4`, reached via `next`) | override `sharp 0.35.3 -> 0.35.4` (satisfies the `next`/`@next/*` range) | `npm audit` no longer lists `sharp` |
| `js-yaml` | GHSA-52cp-r559-cp3m, GHSA-5p4m-2wfm-xmqj, GHSA-2883-xcg3-v3hh (sources 1123911/1138115/1193726/1193727) | scoped overrides `js-yaml@^4 -> 4.3.2`, `js-yaml@^3 -> 3.15.2` (both within the parents' existing major ranges) | `npm audit` no longer lists `js-yaml` |
| `nanoid` | GHSA-2v37-7h3g-55p8 (source 1139427) | override `nanoid -> 3.3.18` (within the `^3.3.8` parent ranges) | `npm audit` no longer lists `nanoid` |
| `@xmldom/xmldom` | GHSA-6mj3-qw4j-hgrw, GHSA-w2rr-34g9-rvrj, GHSA-4w3w-2rp5-g8jm and related (new sources) | scoped overrides `@xmldom/xmldom@^0.9 -> 0.9.12`, `@xmldom/xmldom@^0.8 -> 0.8.15` | `npm audit` no longer lists `@xmldom/xmldom` |
| `fast-uri` | (previously excepted, source 1130720) | resolved by the existing `fast-uri -> 3.1.7` override; no longer surfaces in the production audit | `npm audit` no longer lists `fast-uri` |

Remediation constraints honoured: **no breaking downgrades** and **no
`npm audit fix --force`**. All version moves stay within the parents' declared
semver ranges except the owner-approved `next` pin move.

`ws` is **not** excepted: the workspace overrides it to patched `8.21.3`, which is
compatible with the observed `^8.x` parent ranges. Hono is also **not** excepted:
the resolved Hono version is already above the affected advisory range.
Moderate-only findings remain visible in the audit JSON but do not satisfy the
high/critical blocking threshold.
