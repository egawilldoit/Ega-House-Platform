# Production dependency audit exceptions

Unified CI blocks every new or directly-owned **high/critical** npm advisory. The exceptions below are narrow transitive leaf advisories verified on Node 22.23.1 / npm 10.9.8 on 2026-08-09. They are enforced by advisory source ID in `scripts/ci/audit-production.mjs` and must be re-reviewed by **2026-09-09**.

| Leaf package | Advisory | Classification | Proven path / constraint | Action |
| --- | --- | --- | --- | --- |
| `fast-uri@3.1.4` | GHSA-7p8r-x3mc-p8w7 | transitive, build-time reachable | `@sentry/nextjs -> webpack -> schema-utils -> ajv@8 -> fast-uri`; AJV requires `^3.0.1`, while the safe registry line is v4 | keep latest compatible v3; do not force a major override; re-evaluate upstream |
| `js-yaml@4.1.1` | GHSA-52cp-r559-cp3m, GHSA-5p4m-2wfm-xmqj | transitive tooling | observed through `eslint -> @eslint/eslintrc -> js-yaml`; current parents require v4 | no unsafe major override; re-evaluate upstream |
| `nanoid@3.3.16` | GHSA-2v37-7h3g-55p8 | transitive mobile dependency | `expo-router@6.0.24 -> nanoid@^3.3.8` | keep Expo-compatible line; re-evaluate when Expo Router publishes/resolves a fixed compatible version |
| `image-size@1.2.1` | GHSA-w3rx-r6r6-pgpr, GHSA-5p2g-fcmc-qvqq | transitive Expo/Metro build toolchain | `expo@54 -> @expo/metro -> metro@0.83.3 -> image-size@^1.0.2`; npm proposes the breaking downgrade `expo@53.0.27` | retain Expo 54 / RN 0.81.5 compatibility; do not use `npm audit fix --force`; re-evaluate upstream |

`ws` is **not** excepted: the workspace overrides it to patched `8.21.3`, which is compatible with the observed `^8.x` parent ranges. Hono is also **not** excepted: the resolved Hono version is already above the affected `<=4.12.33` advisory range. Moderate-only findings remain visible in the audit JSON but do not satisfy the high/critical blocking threshold.

An exception is rejected automatically if its vulnerable leaf becomes a direct dependency, if a different high/critical advisory appears, or when the review deadline expires.
