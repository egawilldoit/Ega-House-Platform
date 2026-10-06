# Third-party licence inventory

Point-in-time record of the licence and attribution facts for the first-party
dependencies this repository pins directly, where a reviewer would otherwise have
to read `node_modules` to establish them.

**This is an inventory, not legal advice and not a licence-compliance policy.**
It records what a package declares and what files it ships. It deliberately does
not create obligations, a notice process, a legal framework, or an approval
gate — the supply-chain gate is
[`scripts/ci/audit-production.mjs`](../scripts/ci/audit-production.mjs), and the
exception governance is
[`docs/architecture/dependency-audit-exceptions.md`](architecture/dependency-audit-exceptions.md).
Where this document and either of those disagree about *security posture*, the
script is authoritative.

**Verified:** 2026-10-05 against repository state `16e22cd9`, from the
`package.json`/`LICENSE` files actually present in `node_modules` after
install. Re-verify with the commands in the last section.

## Scope

Direct runtime dependencies of the workspaces, limited to packages whose licence
status is non-obvious from the name. Transitive licences are the
corresponding packages' own responsibility and are not enumerated here; the two
exception-carrying transitives are named in the dependency-audit section of
[`ARCHITECTURE.md`](../ARCHITECTURE.md).

## Model Context Protocol SDK

| Field | Value |
|---|---|
| Packages | `@modelcontextprotocol/client`, `@modelcontextprotocol/core`, `@modelcontextprotocol/server` |
| Version | `2.3.0` (all three, pinned exactly — no range) |
| Declared licence | `Apache-2.0` in each package's `package.json` `"license"` field |
| Licence text location | `node_modules/@modelcontextprotocol/{client,core,server}/LICENSE` |
| `NOTICE` file shipped | **No** — verified by `find` across all three package directories; no file named `NOTICE` or `COPYING` exists, and none of the three packages ships one |
| Declared `files` | `["dist"]` in each package — the published tarball's build output only, but `LICENSE` is present in the installed tree regardless |
| Declared author / repository | `Anthropic, PBC`; `github.com/modelcontextprotocol/typescript-sdk` |
| First-party dependency of | `apps/web` only (`apps/web/package.json`), and `package-lock.json` |

### What the shipped `LICENSE` file actually contains

This matters because the file is **not** a plain Apache-2.0 text. It is one
file with four sections:

1. A **relicensing-transition preamble**: the project states it is moving from
   the MIT License to Apache-2.0; new code and specification contributions are
   Apache-2.0, documentation contributions (excluding specifications) are
   CC-BY-4.0, and contributions whose authors have not granted relicensing
   consent **remain under MIT**.
2. The **full Apache License 2.0** text (`Version 2.0, January 2004`).
3. The **MIT License** text, `Copyright (c) 2024-2025 Model Context Protocol a
   Series of LF Projects, LLC.`
4. A pointer to **CC-BY-4.0** for documentation.

The three packages ship a **byte-identical** `LICENSE`
(`md5 5498bbc0155db622ff063f9f7396da88` for all three). So the MIT section in
that file is not an accident of packaging — it is upstream deliberately
shipping both terms, consistent with the transition preamble.

### What this means, stated without interpretation

- The declared licence in metadata is `Apache-2.0`; the shipped licence text
  carries Apache-2.0 **and** MIT, and upstream has not finished relicensing every
  contribution. Both terms are recorded here because both are present in the
  file, not because a choice between them was made here.
- Apache-2.0 §4(d) conditions NOTICE propagation on the Work *including* a
  `NOTICE` file. **No such file is shipped**, so there is no upstream NOTICE
  content to carry forward. This repository therefore does not create, and must
  not be described as creating, a `NOTICE` obligation for these packages — and
  equally, it is not inventing an exemption.
- Apache-2.0 §4(a) concerns passing on a copy of the licence to recipients, and
  §4(b)/(c) concern marking modified files. This repository does **not** modify
  or vendor the SDK: it consumes the published packages from npm, unmodified, via
  the normal dependency graph. That fact is what makes the obligation small, and
  it is verifiable (there is no `patch:`/`file:`/`link:` override for any
  `@modelcontextprotocol/*` entry in `package-lock.json`).
- The CC-BY-4.0 section governs upstream *documentation*, which this repository
  does not redistribute. It is noted for completeness, not as an obligation.
- **No compliance obligation is asserted here beyond the observation above.**
  Determining what any distributor must do is outside the scope of this file.

## Change discipline

- A dependency **upgrade** that changes a declared licence, or that adds or
  removes a shipped `NOTICE`/licence file, updates this table in the same change
  as the manifest bump. That is the whole obligation here; there is no periodic
  re-review requirement, because nothing in this repository enforces one.
- Anything requiring judgement about redistribution obligations needs an
  authorized human decision recorded in the change, not an entry added to this
  file by an agent.

## Re-verification commands

Run from the repository root after `npm install`:

```bash
# declared licence + shipped files, per SDK package
for p in client core server; do
  printf '%s: ' "$p"
  node -p "const j=require('./node_modules/@modelcontextprotocol/$p/package.json'); j.version + ' ' + j.license + ' files=' + JSON.stringify(j.files)"
done

# a NOTICE or COPYING file would print here; empty output means none exists
find node_modules/@modelcontextprotocol -iname 'NOTICE*' -o -iname 'COPYING*'

# the three LICENSE files are byte-identical
md5sum node_modules/@modelcontextprotocol/*/LICENSE

# the SDK is consumed from the registry, not patched or vendored
grep -n '@modelcontextprotocol' package-lock.json
```
