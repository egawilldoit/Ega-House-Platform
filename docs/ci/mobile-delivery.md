# Mobile Delivery — Build Once, Test That Exact Binary

## Architecture

```text
PR
  -> GitHub CI (unified-platform-validation.yml) — ubuntu-latest only
  -> merge to main
  -> Vercel deploys web + Hono API (unchanged)

Manual / tag Mobile Delivery (mobile-delivery.yml)
  -> GitHub preflight (ubuntu-latest) — zero Blacksmith cost
  -> Blacksmith APK build (blacksmith-2vcpu-ubuntu-2404) — one compile
  -> temporary exact APK artifact (retention 1 day)
  -> GitHub runtime proof (ubuntu-latest) — installs/tests SAME binary
  -> optional GitHub Release (tagged RC/stable)
  -> delivery summary
```

## Why Blacksmith is only used for Gradle/APK compile

- Native Android compilation (`./gradlew assemble*`) is the only step that benefits from Blacksmith's cached Android/Gradle acceleration and isolates expensive native minutes.
- All verification (TypeScript, Expo doctor, unit tests, bundle export, emulator, Maestro) runs on free GitHub-hosted `ubuntu-latest`.
- Blacksmith transparently redirects `actions/setup-node`, `actions/setup-java`, and upstream caches, so we use official cache actions — no paid forks.

## Runner policy

| Runner | Label | When it runs | Cost guardrail |
|---|---|---|---|
| GitHub | `ubuntu-latest` | Every PR / push to main, plus preflight + runtime proof | Free for public repo |
| Blacksmith | `blacksmith-2vcpu-ubuntu-2404` | Only `workflow_dispatch` or `mobile-v*` tag | 2 vCPU, timeout 40 min, no matrix, no paid add-ons |

Blacksmith free-tier assumptions (2026-08-25): standard plan includes free minutes per month; we do not enable Sticky Disks, Docker layer paid cache, static IPs, or larger runners. See `docs.blacksmith.sh` and `blacksmith.sh/pricing`.

## How to dispatch an RC / stable

### Manual validation (main)

Trigger via GitHub UI or CLI:

```bash
gh workflow run mobile-delivery.yml --ref main \
  -f build_variant=release -f runtime_proof=true -f authenticated_e2e=false
```

Default source is the selected workflow ref (prefer `main` for official RC validation).

### Tagged release

A human creates the tag intentionally (no automation invents tags):

```bash
git tag mobile-v1.0.0-rc.1 a9b43ac
git push origin mobile-v1.0.0-rc.1
# or stable:
git tag mobile-v1.0.0 a9b43ac
git push origin mobile-v1.0.0
```

Tag patterns understood by the workflow:

- `mobile-vX.Y.Z-rc.N` → prerelease (e.g. `mobile-v1.0.0-rc.1`)
- `mobile-vX.Y.Z` → stable release (e.g. `mobile-v1.0.0`)

A tagged run builds the exact immutable tag SHA (checked out via `github.sha`), not a moving branch.

## How to find the APK

- **Temporary handoff:** GitHub Actions artifact `ega-house-apk-<SHA>` (retention 1 day) — consumed by the runtime proof job. Do not use as permanent storage.
- **Permanent:** GitHub Release for the tag, containing `ega-house-<version>-<shortsha>-<variant>.apk`, `release-manifest.json`, `SHA256SUMS`.

## How to read release-manifest.json

```json
{
  "repository": "egawilldoit/Ega-House-Platform",
  "gitSha": "<40-char SHA>",
  "gitRef": "refs/tags/mobile-v1.0.0-rc.1",
  "version": "1.0.0",
  "variant": "release",
  "apiBaseUrl": "https://ega-api.egawilldoit.online",
  "builtAt": "2026-08-25T12:00:00Z",
  "runner": "blacksmith-2vcpu-ubuntu-2404",
  "apkFile": "ega-house-1.0.0-a9b43ac-release.apk",
  "apkSha256": "<sha256>"
}
```

Deterministic filename `ega-house-<version>-<shortsha>-<variant>.apk`; SHA is authoritative, not `run_number`.

## How to know which SHA is installed

- Runtime proof verifies checksum before install: `(cd apk-dist && sha256sum -c SHA256SUMS)` and again compares `apkSha256` from the manifest.
- Installed binary's manifest is archived alongside `SHA256SUMS` in the release.

## What PASS / BLOCKED means

| Gate | Result | Meaning |
|---|---|---|
| Preflight | PASS | Source valid, Unified CI green for exact SHA, production API healthy |
| Blacksmith build | PASS | One APK compiled, manifest + checksum produced |
| APK checksum | PASS | SHA match between manifest and file (integrity) |
| Android install/launch/liveness/UI | PASS | Ladder L6 chain proven on the exact Blacksmith binary |
| Maestro welcome | PASS | `00-welcome.yaml` passed on the booted emulator |
| BLOCKED_CI_NOT_GREEN | BLOCKED | Exact SHA has no successful Unified CI — fix CI first |
| BLOCKED_PRODUCTION_API | BLOCKED | `ega-api.egawilldoit.online` health/ready/401 probes failed |
| BLOCKED_ANDROID_SIGNING | BLOCKED | Release APK unsigned/uninstallable |
| FAIL_ARTIFACT_INTEGRITY | FAIL | Checksum mismatch |
| BLOCKED_EXTERNAL_BLACKSMITH_SETUP | BLOCKED | Blacksmith GitHub integration not installed for `egawilldoit` org |

No gate is silently bypassed.

## Feature delivery mapping

`scripts/ci/feature-delivery-map.mjs` inspects the PR diff and classifies:

WEB, API, DATABASE, CONTRACTS, DOMAIN, APPLICATION, DATA_ACCESS, API_CLIENT, MOBILE

as `CHANGED` (direct file match), `AFFECTED` (transitive dependency), or `NO_CHANGE`.

Key propagation (derived from code truth — `apps/mobile` imports `@ega/api-client`, `@ega/contracts`, `@ega/domain`):

- `packages/api-client/**` → `API_CLIENT CHANGED`, `MOBILE AFFECTED`
- `packages/contracts/**` → `CONTRACTS CHANGED`, `API_CLIENT AFFECTED`, `MOBILE AFFECTED`
- `packages/domain/**` → `DOMAIN CHANGED`, `CONTRACTS/MOBILE AFFECTED`
- `apps/web/**` alone → `WEB CHANGED`, `MOBILE NOT AFFECTED`

The Unified CI mobile filter (`unified-platform-validation.yml`) includes `packages/api-client/**`, `packages/contracts/**`, `packages/domain/**` so Mobile JS verification runs when shared packages it consumes change.

The `delivery-map` job in unified CI writes this table to `$GITHUB_STEP_SUMMARY` on every PR.

## Free-usage guardrails (encoded in YAML + tests)

- Blacksmith: manual/tag only, no `pull_request`/`push:main`, one job, `2vcpu`, `timeout:40`, no matrix, cancels superseded manual/RC runs, no schedule/nightly/emulator/Maestro/Docker/paid add-ons.
- GitHub: `ubuntu-latest` only, no larger runners, path-aware unified CI, no Gradle in normal CI, APK artifact retention 1 day, permanent binaries on Releases, no duplicate APK uploads.

Tests: `scripts/ci/feature-delivery-map.test.mjs` and `scripts/ci/mobile-delivery-guardrails.test.mjs` (`node --test`).

## Blacksmith setup (external blocker)

If the Blacksmith integration is not yet installed:

1. Open Blacksmith console → authorize/install GitHub integration for organization `egawilldoit`
2. Grant repository access to `Ega-House-Platform`
3. Rerun Mobile Delivery

Do not change the runner back to `ubuntu-latest`; leave the workflow correct and report `BLOCKED_EXTERNAL_BLACKSMITH_SETUP`.
