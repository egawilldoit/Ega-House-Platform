# QA dependency security backports

The QA stack upgrades published vulnerable dependencies first. As of 2026-10-15,
`braces@3.0.3` and `node-forge@1.4.0` have no patched npm releases. Their Expo
transitive paths remain in the production audit; they are not excluded as tooling.

Two immutable source archives are pinned by root npm overrides and lock integrity:

- `braces`: FSDevelop/braces commit `28d440b5dd449dbf1fe6f3506cf94ecca4d02660`,
  proposed in <https://github.com/micromatch/braces/pull/72> (closed, unmerged).
  Bounds parser and recursive AST processing to 100 levels and rejects cyclic
  parent links. It also includes upstream master fixes since 3.0.3 for unpaired
  quotes and set expansion; compare against the 3.0.3 tag when reviewing.
- `node-forge`: Krysthyan/forge commit `ceba34402e329f0365134f23fe19898756527d65`,
  proposed in <https://github.com/digitalbazaar/forge/pull/1152> (open, unmerged).
  Requires the nested DigestAlgorithm to contain exactly the OID plus optional
  NULL, rejecting unconsumed children. Relative to 1.4.0, only RSA validation,
  its regression, the changelog and prerelease package version change.

These are unmerged contributor patches, not official patched releases. The
repository owns verification until official releases replace them. No npm
package version is fabricated and no audit exception expiry is extended.

`scripts/ci/security-backports.json` records source archive integrity and security
file hashes. The production audit verifies every locked installed copy, the root
override, integrity and hashes, then executes depth and RSA parsing regressions.
Only the exact advisory source/package pair with this affirmative proof is
accepted as patched. An unknown advisory, missing copy, registry substitution,
changed file or failed probe blocks CI. Raw npm audit still reports braces because
its package version remains 3.0.3; the audit output identifies verified backports
separately from registry counts.

Before patching, all four braces depth probes and both nested DigestAlgorithm
probes failed against the installed registry packages. They pass against the
pinned sources, while ordinary brace expansion and valid RSA signatures with
and without AlgorithmIdentifier NULL parameters continue to work.

Replace these pins with official patched releases as soon as available, remove
the corresponding backport acceptance/proof records, and rerun production audit,
Expo/mobile checks and web/consumer checks. Do not widen advisory acceptance to
accommodate a future audit finding.
