# Production dependency audit exceptions

Unified CI blocks every new or directly-owned **high/critical** npm advisory. This
file records the exceptions enforced by advisory source ID in
`scripts/ci/audit-production.mjs`, plus the remediation history.

Re-reviewed **2026-10-05**.

An earlier revision of this file claimed there were no active exceptions. That
was wrong before this revision and is corrected below: the registry in
`scripts/ci/audit-production.mjs` has carried active entries throughout, and the
table is now generated from the same source the gate reads. Any high/critical
advisory that is not listed here is blocking.

This revision corrects a second error. The seven entries that expired 2026-10-15
recorded "no patched release" as their reason, and that was also wrong — every one
of their advisories had a fixed release, each one inside the range its own parent
already required. They were remediated rather than renewed, so the count of active
exceptions drops from nine to two. The reasoning and evidence are under
[Remediated advisories](#remediated-advisories).

## Active exceptions

Two entries, both in the 2026-11-05 cohort. Each entry names one advisory source ID
on one package — there are no wildcards and no aggregate entries, so an unrelated
advisory cannot inherit an acceptance.

| Source | Package | Advisory | Expires | Why it cannot be fixed now |
| --- | --- | --- | --- | --- |
| 1240992 | `braces` | GHSA-vfj7-8cjw-p6xm | 2026-11-05 | **no patched release exists — 3.0.3 is the newest version ever published** |
| 1240912 | `node-forge` | GHSA-86w9-cpqp-85rv | 2026-11-05 | **no patched release exists — 1.4.0 is the newest version ever published** |

An entry belongs in this table only while no patched release exists. Where a patch
does exist, the advisory is remediated and the entry is deleted rather than given a
later `reviewBy`; the seven entries that used to expire on 2026-10-15 were resolved
that way on 2026-10-05 and are listed under
[Remediated advisories](#remediated-advisories) below.

The two 2026-11-05 entries were added on 2026-10-05 after the advisories they
cover were published. Both `braces` and `node-forge` are absent from the shipped
bundle and from all application source: `braces` is reached only through
`micromatch` under the jest, metro and `@expo/metro` toolchain, and `node-forge`
only through `@expo/cli` and `@expo/code-signing-certificates`, where it verifies
EAS build artifacts rather than untrusted input. Each entry records its affected
surface, why it is unfixable, an owner, and its `reviewBy` date in
`audit-production.mjs`.

Both carry `allowDirect`, because the gate attributes a leaf advisory to the
*direct* package that reaches it — so `braces` reached through the direct `expo`
dependency trips the direct-dependency rule even though the vulnerable package is
transitive. Removing the flag re-blocks the identical report, which is asserted
in `audit-production.test.mjs`, so the flag is load-bearing rather than a bypass.

The 2026-11-05 entries expire in a month and will block CI on that date until they
are re-reviewed. That is the intended behaviour, not a defect, and
`audit-production.test.mjs` asserts it rather than assuming it.

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
| `next` (direct, critical) | GHSA-vcvr-r3jv-pc5j (`>=16.2.0 <16.3.6`), RCE in `next/og` `ImageResponse` | `next 16.3.5 -> 16.3.8` (non-major) — upgraded rather than accepted, because a compatible patched release exists. No application source imports `next/og`, so runtime exposure was already nil, but a critical advisory on a direct dependency is fixed rather than documented around | production audit `critical 1 -> 0`; `workspace-proofs` Next pin asserts 16.3.8; `audit-production.test.mjs` asserts no registry entry ever names this advisory or `next` |
| `sharp` | GHSA-rgj7-g3m4-5g8c (`<0.35.4`, reached via `next`) | override `sharp 0.35.3 -> 0.35.4` (satisfies the `next`/`@next/*` range) | `npm audit` no longer lists `sharp` |
| `js-yaml` | GHSA-52cp-r559-cp3m, GHSA-5p4m-2wfm-xmqj, GHSA-2883-xcg3-v3hh (sources 1123911/1138115/1193726/1193727) | scoped overrides `js-yaml@^4 -> 4.3.2`, `js-yaml@^3 -> 3.15.2` (both within the parents' existing major ranges) | `npm audit` no longer lists `js-yaml` |
| `nanoid` | GHSA-2v37-7h3g-55p8 (source 1139427) | override `nanoid -> 3.3.18` (within the `^3.3.8` parent ranges) | `npm audit` no longer lists `nanoid` |
| `@xmldom/xmldom` | GHSA-6mj3-qw4j-hgrw, GHSA-w2rr-34g9-rvrj, GHSA-4w3w-2rp5-g8jm and related (new sources) | scoped overrides `@xmldom/xmldom@^0.9 -> 0.9.12`, `@xmldom/xmldom@^0.8 -> 0.8.15` | `npm audit` no longer lists `@xmldom/xmldom` |
| `fast-uri` | (previously excepted, source 1130720) | resolved by the existing `fast-uri -> 3.1.7` override; no longer surfaces in the production audit | `npm audit` no longer lists `fast-uri` |
| `brace-expansion` 1.x (six copies) | GHSA-qhr7-859c-m2p7 (`<1.1.20`), GHSA-6j4f-fj2g-mc7p (`<1.1.19`), and GHSA-q2hr-2g5m-vwhr (`<1.1.21`) | scoped override `brace-expansion@^1 -> 1.1.21`, **upgraded rather than accepted** | `npm audit` no longer lists `brace-expansion` |
| `brace-expansion` 2.x | GHSA-qhr7-859c-m2p7 (`>=2.0.0 <2.1.6`), GHSA-6j4f-fj2g-mc7p (`>=2.0.0 <2.1.5`), GHSA-q2hr-2g5m-vwhr (`>=2.0.0 <2.1.7`) | scoped override `brace-expansion@^2 -> 2.1.7` | `npm audit` no longer lists `brace-expansion` |
| `brace-expansion` 5.x | GHSA-qhr7-859c-m2p7 (`>=4.0.0 <5.0.11`), GHSA-6j4f-fj2g-mc7p (`>=4.0.0 <5.0.10`), GHSA-q2hr-2g5m-vwhr (`>=4.0.0 <5.0.12`) | scoped override `brace-expansion@^5 -> 5.0.12` | `npm audit` no longer lists `brace-expansion` |
| `undici` | GHSA-rfgv-xxqx-mfg5 (`>=6.7.0 <6.28.1`), plus GHSA-3wwx-pv8p-q78v and GHSA-r53p-7pc4-xj5r | scoped override `undici@^6 -> 6.29.0` | `npm audit` no longer lists `undici` |

### The seven 2026-10-15 entries, and why the "no patched release" reason was wrong

Six `brace-expansion` advisories and one `undici` advisory were carried as entries
until 2026-10-15, each recording "no patched release". That reason was false, and
the entries were **remediated instead of renewed**. Every affected advisory range
had a published release outside it, and — the part that matters — each of those
releases already satisfied the range its own parent declared:

| Advisory range | Vulnerable | Patched | Parent that requires it | Parent's declared range | Override in range? |
| --- | --- | --- | --- | --- | --- |
| `<1.1.19`, `<1.1.20`, `<1.1.21` | 1.1.18 / 1.1.14 | **1.1.21** | `minimatch@3.1.5` (under `glob@7.2.3` → jest, `@react-native/codegen`, `react-native`, `rimraf`, `test-exclude`) | `^1.1.7` | yes — same major, above the floor |
| `>=2.0.0 <2.1.5`, `<2.1.6`, `<2.1.7` | 2.1.4 | **2.1.7** | `minimatch@9.0.9` (under `expo > @expo/cli`) | `^2.0.2` | yes |
| `>=4.0.0 <5.0.10`, `<5.0.11`, `<5.0.12` | 5.0.9 | **5.0.12** | `minimatch@10.2.6` (hoisted) | `^5.0.8` | yes |
| `>=6.7.0 <6.28.1` (+ two lower severities) | 6.28.0 | **6.29.0** | `@expo/cli@54.0.27` | `^6.18.2` | yes |

Because every move is inside the parent's own range, the remediation rests on
nothing but an ordinary upgrade the repository had not taken — not on npm tolerating
an out-of-range override. `audit-production.test.mjs` reads those parent specs out
of `package-lock.json` and fails if a later parent bump makes an override
out-of-range.

This also cleared the three moderate `brace-expansion` advisories
(GHSA-q2hr-2g5m-vwhr) and the moderate/low `undici` advisories that the old pins
carried, because each patched release is outside all of them at once.

**Behavioural compatibility, checked rather than assumed.** `brace-expansion`'s
public surface differs between major lines — 1.x and 2.x export a single callable,
5.x exports `{ expand, EXPANSION_MAX, ... }` — so each override preserves its own
line's shape, and no line is pushed onto another's API. For each of the six
versions (1.1.18→1.1.21, 2.1.4→2.1.7, 5.0.9→5.0.12) the patched build was executed
and returns byte-identical output to the vulnerable build on a fixed set of ten
brace patterns (alternation, numeric and alpha ranges, nested groups, empty
alternation, escaped braces, and a non-brace glob). The 5.x `expand` still honours
the `max` option that `minimatch` passes, and `minimatch` is exercised for real by
`npm run mobile:test` (jest) and `npm run mobile:bundle` (Metro export). 5.0.12 adds
`EXPANSION_MAX_DEPTH` and `EXPANSION_MAX_REWRITES` exports; these are additive
constants, not removals. For `undici`, `@expo/cli` imports `fetch`, `Headers`,
`Response`, `Agent` and `EnvHttpProxyAgent`; all five are exported by 6.28.1 and
6.29.0, both of which declare the same `node >=18.17` engine as 6.28.0.

**Reachable surface.** Neither package is imported by any first-party source in
`apps/`, `packages/` or `scripts/` — verified by grep. `brace-expansion` is reached
only through `minimatch` (glob, jest, Metro, and the Expo CLI), and `undici` only
through `expo > @expo/cli`, which is Expo build/dev tooling rather than the shipped
app runtime. So runtime exposure was already low at this revision; the upgrade was
taken anyway because a compatible fix existed, which is the same standard applied to
the `next` critical above.

Remediation constraints honoured: **no breaking downgrades** and **no
`npm audit fix --force`**. The Metro move stays on the maintained `0.83.x`
line and keeps the complete Metro package family coherent at `0.83.8`. The
`brace-expansion` and `undici` overrides each stay inside the major their parent
already requires, so no consumer sees a major it did not ask for.

`ws` is **not** excepted: the workspace overrides it to patched `8.21.3`, which is
compatible with the observed `^8.x` parent ranges. Hono is also **not** excepted:
the resolved Hono version is already above the affected advisory range.
Moderate-only findings remain visible in the audit JSON but do not satisfy the
high/critical blocking threshold.
