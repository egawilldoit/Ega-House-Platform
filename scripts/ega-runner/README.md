# EGA Runner

Durable pgmq consumer for the EGA House autonomous implementation pipeline.

## Architecture

```
Linear → Signed Webhook → Supabase Edge Function → automation.implementation_runs
                                                          ↓
                                                     pgmq queue
                                                          ↓
                                                    EGA Runner
                                                          ↓
    ┌─────────────────── Full Pipeline ───────────────────┐
    │  1. Claim run, persist preparing event               │
    │  2. Fetch Linear issue spec + parent spec            │
    │  3. Recheck authorization gates                      │
    │  4. Build context_hash                               │
    │  5. Pin base SHA, create deterministic branch        │
    │  6. Create git worktree                              │
    │  7. Spawn Hermes CLI in worktree                     │
    │  8. Read .ega-runner/hermes-result.json              │
    │  9. Verify against Git/GitHub                        │
    │ 10. Update GitHub check run                          │
    │ 11. Wait for CI checks                               │
    │ 12. Verify Vercel deployment by SHA                  │
    │ 13. Post Slack thread                                │
    │ 14. Archive PGMQ message (only after evidence)       │
    └──────────────────────────────────────────────────────┘
```

## V1 Smoke Mode (backward compatible)

Validates the runner infrastructure without real execution:

```
Claim → heartbeat (3 cycles) → events → cancel → archive
```

```bash
cd scripts/ega-runner
npm run smoke
```

## V2 Full Pipeline (default)

Full autonomous delivery from queue message to PR:

```bash
cd scripts/ega-runner
npm start
```

Requires:
- DATABASE_URL (Postgres with pgmq)
- Hermes CLI installed and available on PATH
- gh CLI authenticated (for GitHub operations)
- Git remotes configured
- Optional: VERCEL_TOKEN, EGA_RUNNER_SLACK_WEBHOOK_URL

## Vertical Slice

This first implementation proves:

- **Durable queue read** via `pgmq.read()` with visibility timeout
- **Atomic run claim** — `status: queued → preparing`, guarded by optimistic locking
- **Execution lease** — `automation.implementation_runs.lease_expires_at`
- **Queue visibility lease** — `pgmq.set_vt()` extends visibility while processing
- **Coordinated heartbeat** — extends both DB lease and queue VT every 60s
- **Event persistence** — `automation.implementation_events`
- **Safe message finalization** — `pgmq.archive()` only after proven completion
- **Signal handling** — SIGINT/SIGTERM stop accepting work, do not archive incomplete messages

## Prerequisites

- DATABASE_URL in the project `.env.local` (PostgreSQL with pgmq v1.5.1)
- The `hermes_implementation_jobs` pgmq queue must exist
- Node.js ≥ 20

## Setup

```bash
# Dependencies are installed from the project root
cd scripts/ega-runner
npm install    # installs postgres + dotenv
```

## Usage

### Normal mode (foreground — one job at a time)

```bash
cd scripts/ega-runner
npm start
```

### Smoke mode

Reads one queue message, claims it, runs 3 heartbeat cycles, persists events,
cancels the run, and archives the message.

```bash
cd scripts/ega-runner
npm run smoke
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | (required) | Postgres connection string |
| `EGA_RUNNER_ID` | `ega-runner-<hostname>-<pid>` | Runner identity |
| `EGA_RUNNER_QUEUE_NAME` | `hermes_implementation_jobs` | pgmq queue name |
| `EGA_RUNNER_POLL_SECONDS` | `10` | Poll interval when queue empty |
| `EGA_RUNNER_VISIBILITY_TIMEOUT_SECONDS` | `300` | Initial pgmq visibility timeout |
| `EGA_RUNNER_HEARTBEAT_SECONDS` | `60` | Heartbeat interval |
| `EGA_RUNNER_LEASE_SECONDS` | `300` | DB lease duration |
| `EGA_RUNNER_SMOKE_MODE` | `false` | Single-cycle smoke test |
| `EGA_RUNNER_MAX_TURNS` | `50` | Maximum Hermes execution turns |
| `EGA_RUNNER_HERMES_TIMEOUT_MS` | `1800000` | Hermes execution timeout (ms, 30 min) |
| `EGA_RUNNER_SLACK_CHANNEL` | `#hermes-today` | Slack channel for notifications |
| `EGA_RUNNER_SLACK_WEBHOOK_URL` | (none) | Slack webhook URL |
| `EGA_RUNNER_REPO_ROOT` | `process.cwd()` | Git repository root path |
| `VERCEL_TOKEN` | (none) | Vercel API token |
| `SLACK_BOT_TOKEN` | (none) | Slack Bot API token |

## Safety invariants

- Never use `pgmq.pop()` — messages are never deleted before processing
- A crashed runner lets the queue message become visible again after VT expiry
- The DB lease acts as a second ownership indicator
- If heartbeat detects lease loss, processing stops immediately
- Failed processing does NOT archive the queue message — it reappears for retry
- Queue messages are classified explicitly on claim attempt:
  - **CLAIMED** — normal processing, archives on success, NOT on failure
  - **ACTIVE_VALID_LEASE** — another healthy runner owns it; message preserved (not archived), VT expires naturally
  - **STALE_EXPIRED_LEASE** — lease expired; atomically marks run as `stale`, persists `run_stale` event, THEN archives
  - **TERMINAL** — run already completed/cancelled; archives the obsolete message
  - **NOT_FOUND** — run record missing; archives with diagnostic evidence
  - **CLAIM_RACE_LOST** — transient race; message preserved for retry
  - **UNKNOWN_INCONSISTENT_STATE** — fail closed; message preserved for investigation
- Stale run marking is atomic and preserves evidence (attempt_number, claimed_by, original timestamps)
- **Never trust Hermes exit code/prose alone** — every claim verified against Git/GitHub
- **Never work on main** — deterministic branches per attempt
- **Never archive on ambiguity, exception, or lease loss**

## Current Limitations

- **Mock Linear client**: Issue fetching uses a synthetic mock (returns ready-for-hermes, Implementation project). Replace with real GraphQL client for production.
- **No stale-run recovery engine**: When a run is marked `stale`, a new Attempt 2 row must be created externally
- **No parallel worker support**: Single-run-at-a-time design
- **V1 human review gate**: PRs are created but not auto-merged
- **Hermes CLI dependency**: Requires Hermes installed and on PATH
- **GitHub CLI dependency**: Requires `gh` authenticated

## Future

- [ ] Real Linear GraphQL client
- [ ] Stale-run recovery engine (auto-create Attempt 2)
- [ ] Hermes API `/v1/runs` integration
- [ ] Parallel worker support
- [ ] Systemd service (`ega-runner.service`)
- [ ] Slack slash commands for pipeline status
