# Navigation cost measurement

Reproducible before/after metrics for authenticated workspace navigation. This
is a measurement tool, not a performance budget; a change must not claim an
improvement without the recorded numbers from the same environment.

## What is measured

| Metric | Source | Meaning |
| --- | --- | --- |
| Server REST requests | Loopback counting proxy in front of the disposable Supabase API | PostgREST requests (`.from(...)`, `.rpc(...)`) made by the Next server while rendering one route. Reported as a median over `--runs`. |
| Server Auth requests | Same proxy | Supabase Auth lookups (`/auth/v1/*`), normally session/claims reads. Reported separately so identity cost is not hidden inside data cost. |
| Client First Load JS | `.next/diagnostics/route-bundle-stats.json` (Next 16 Turbopack build) | The route's `firstLoadUncompressedJsBytes` emitted by `next build`. The script falls back to summing `.next/app-build-manifest.json` chunks for webpack builds. |
| Playwright navigation latency | `page.goto` until the first `h1` is visible, then 500 ms | Cold document navigation wall time at 1280×900 (domcontentloaded; realtime subscriptions make `networkidle` unusable). Client-side link latency is intentionally not mixed into this number. |

The proxy never records headers, cookies, or request bodies. It refuses any
Supabase target that is not loopback.

## Procedure

From the repository root:

```text
npm ci
node scripts/e2e/local-backend.mjs start
node scripts/e2e/with-env.mjs npm run build --workspace @ega/web
node scripts/navigation-cost/measure.mjs --label baseline --runs 3
```

`--label` names the JSON report under `docs/reports/navigation-cost/`. To compare
two revisions, build and measure each revision in the same checkout (or an
identically provisioned checkout) and keep the same route list, machine, and
local-backend state.

Useful options:

```text
--routes /today,/tasks,/tasks/projects,/money,/review,/goals?view=all,/timer
--runs 3
--out docs/reports/navigation-cost/custom.json
--static-only                 # First Load JS only; no backend or browser
--env-file PATH               # loopback environment JSON from another disposable run
--web-dir PATH                # apps/web checkout to read .next and start (comparison runs)
```

`--env-file` exists so an isolated disposable backend on alternate loopback
ports can be measured when the default ports are occupied. The file must still
point at loopback Supabase/Postgres; the script rejects anything else.

The disposable backend and the production server are cleaned by the script. The
backend itself is not started by this script.

## Baseline

Recorded on 2026-11-22 on the same VM and disposable backend, `--runs 3`:

- baseline: [`baseline-b0e30aca.json`](baseline-b0e30aca.json) at `b0e30aca`
- after: [`after-product-nav.json`](after-product-nav.json) on `followup/product-nav`

| Route | REST baseline → after (Auth) | First Load JS baseline → after | Playwright median baseline → after |
| --- | --- | --- | --- |
| `/today` | 22 → 22 (5 → 4) | 1244.5 → 1245.0 KiB | 3181 → 2155 ms |
| `/tasks` | 17 → 17 (2 → 2) | 1243.7 → 1244.2 KiB | 2167 → 3020 ms |
| `/tasks/projects` | 8 → 8 (2 → 2) | 1134.0 → 1134.6 KiB | 1856 → 2093 ms |
| `/money` | 14 → 14 (2 → 2) | 1202.0 → 1202.4 KiB | 2580 → 1791 ms |
| `/review` | 26 → 26 (2 → 2) | 1134.7 → 1135.3 KiB | 2441 → 2329 ms |
| `/goals?view=all` | 8 → 8 (2 → 2) | 1132.8 → 1133.4 KiB | 2261 → 1941 ms |
| `/timer` | 10 → 10 (2 → 2) | 1150.0 → 1150.5 KiB | 1760 → 1524 ms |

Server REST request counts are unchanged. First Load JS rises by 0.4–0.6 KiB
from the added contextual links and palette entries; no improvement is claimed.
Playwright latency moved in both directions under a shared, loaded host, so it
is recorded but not treated as a regression or improvement signal.

Treat the numbers as environment-specific evidence: they are comparable to
another run on the same VM and local backend, not to production traffic.
