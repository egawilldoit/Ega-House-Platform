# Hermes daily assistance — opt-in recipe (PO-14, issue #359)

**Status: OPT-IN DOCUMENTATION — nothing is enabled by this repo.** This
recipe describes how an owner may connect Hermes (Meta's personal
assistant) to EGA House through the existing Personal Operations MCP tools
(#358). EGA House implements no scheduler, sends no chat messages, and
performs no finance writes on its own. Activation requires the owner's own
OAuth consent; every write below additionally requires confirmation and a
verified receipt.

## What exists in EGA House (canonical owners)

| Concern | Canonical owner |
|---|---|
| OAuth grants, permission profiles | `apps/web/src/lib/mcp/permissions.ts` (`personal_operations` / `personal_operations_writer`) |
| Tool registry | `apps/web/src/lib/mcp/server.ts` (`ega_personal_ops_*`) |
| Expense ledger | PO-06 `personal_expenses` (idempotent create + fingerprint conflict) |
| Daily check-ins | PO-05/PO-10 `daily_checkins` (one row per owner/local date, partial merge) |
| Quiet hours | notification settings (owner timezone, explicit suppress outcome) |
| Corrections | EGA House UI (Apps reconcile from canonical stores) |

Hermes never writes local records. It only calls the MCP tools, and EGA
House stays the only place where work, money and routine facts exist.

## Prerequisites

1. An EGA House account.
2. Hermes with MCP support and a browser where the owner can complete
   OAuth consent.
3. The owner explicitly chooses the grant profile:
   - **Read-only assistance:** `personal_operations` (reads only).
   - **Write assistance:** `personal_operations_writer` (reads + expenses +
     check-ins) — grant this only if the owner wants Hermes to ever record
     money or routine facts.
4. Legacy profiles (`read_only`, `task_manager`, `workspace_manager`) do
   **not** include finance/routine access, and previously issued tokens are
   never auto-upgraded.

## Enable (owner-run only)

1. Open Hermes and add the EGA House MCP endpoint.
2. Complete OAuth and select the grant profile.
3. In EGA House, confirm the grant appears in **Settings → Account → Arena
   workspaces** (or equivalent account surface) with the profile name you
   chose.
4. Enable the two cron nudges below *inside Hermes only* (this repository
   registers no schedule).

## 06:00 morning planning prompt (recipe)

> Read `ega_personal_ops_summary` for today. Answer in at most five short
> lines: what is the tracked work so far, what is the top open item from
> Today, and what is the next concrete action. Do not write anything.
> Before answering, check whether the current time falls inside the owner's
> quiet hours; if it does, stay silent (do not send the message).

Quiet hours take precedence over the prompt: a scheduled nudge never sends
during quiet hours or protected evening leisure. Quiet hours win over
morning prompts by default.

## Evening check-in prompt (recipe)

> Read `ega_personal_ops_summary` for today. If the owner says something
> like "Spent 35 MAD on groceries and ran 30 minutes":
>
> 1. Resolve ambiguity first. If the amount, category or date is uncertain,
>    ask one short clarifying question and write nothing yet.
> 2. Ask the owner to confirm the resolved values (amount, category, date,
>    run minutes) in a single message.
> 3. Only after confirmation, call, in order:
>    - `ega_create_personal_ops_expense` with a fresh, stable
>      `idempotencyKey` (retained across retries of the same message, so a
>      replayed message dedupes instead of duplicating),
>    - `ega_save_personal_ops_checkin` for the owner-local date with only
>      the run fields the owner confirmed.
> 4. Show the verified receipt (stored record + expense id) back to the
>    owner. Never claim "saved" before the tool returns `ok: true`.
> 5. If the grant is read-only or revoked, report the refusal honestly
>    (`PERMISSION_DENIED` / `UNAUTHENTICATED`) and give the owner the
>    direct link to Today/Shutdown. Never fake a write.
> 6. If MCP is unreachable, report the outage, keep the owner's message
>    visible as unsent, and offer the in-app Shutdown form instead.

## Safety contract (acceptance behaviors this recipe relies on)

- One logical purchase → one expense record: retries and cron replays reuse
  the same idempotency key; a new purchase gets a new key.
- One owner/local-date → one check-in: partial saves merge, so a delayed
  retry cannot erase fields the owner set elsewhere.
- Revocation takes effect before the next effectful call: the writer grant
  is checked per invocation.
- Financial copy stays generic in lock-screen/notification surfaces (existing
  finance privacy policy); amounts never appear in notification previews.
- Audit events and rate limits apply to every tool call (audited wrappers);
  failures surface as typed errors, never optimistic success.

## Disable

1. Delete or revoke the EGA House MCP grant on the Hermes side.
2. Revoke the grant in EGA House account settings.
3. Delete the two cron nudges in Hermes. EGA House keeps working normally
   without Hermes; nothing here owns a schedule.

## What is NOT part of this integration

- No EGA House-implemented scheduler or chat sender.
- No autonomous financial writes: every write needs confirmation + receipt.
- No new backend, ledger, habit engine, or Hermes-side record store.
- Live Hermes/OAuth delivery proof is outside this repository and is not
  claimed by this recipe; it must be verified on the owner's own Hermes
  setup before declaring the integration functional.
