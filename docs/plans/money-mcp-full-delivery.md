# Money and MCP: full delivery contract

Status: ready for implementation; no issue is complete merely because this plan exists.
Requested by the user on 2026-11-11. Source baseline: `main`,
`d4b0a6334d774e55f6af4afc79e0fc64a055ffc4`, after `git pull --ff-only`.
Refresh repository and hosted state at execution time.

## 1. Assignment and completion boundary

Deliver the entire Money Tracker operating workflow inside EGA House, accessible
both manually in the Money app and directly through authenticated MCP tools.
Manual app scope is the responsive web Money workspace; preserve existing native
mobile expense entry, but a new native Money screen is not required.
The user should be able to return, open Money, connect ChatGPT and use the system.
The example “I spent 11 on coffee today @egahousemcp” is one required interaction.
It is not the finish boundary.

This document is the self-contained implementation backlog. `MONEY-01` and similar
identifiers are local issue identifiers, not existing GitHub issue numbers. If
issues are published later, retain these identifiers and link their real numbers.
Each issue delivers product behavior through its affected persistence, shared
logic, contracts, UI and MCP adapters. Tests support acceptance; adding tests or
mock tool responses alone never completes an issue.

The source requirements are the user's `MONEY_TRACKER_OPERATING_HANDOFF.md` and
four read-only audits: domain/persistence, MCP/ChatGPT, app/analytics, and handoff
adoption. This contract incorporates their required behavior and resolves the
implementation defaults below. It does not import private financial values.

Completion requires all issues integrated, reviewed migrations applied to the
verified target, affected deployments observed, and authenticated app/MCP paths
working against the same durable records. Real-data cutover additionally requires
the actual workbook or a verified owner-provided export. Missing external access
must be reported separately from completed product functionality.

## 2. Scope and standing authorization

The user authorized a continuous run, serial merges, existing environment use and
required migrations. See the scoped authorization in [AGENTS.md](../../AGENTS.md).
This includes releasing the scoped changes through the existing main-only
deployment path and configuring required Money/MCP feature switches. It does not
authorize unrelated infrastructure changes or changing the user's OAuth consent.
This authority ends on the completed MONEY-14 handback or user revocation, not on
an intermediate PR, tool wait, temporary blocker or context compaction.

The delivery agent must:

1. Start from freshly fetched `origin/main`; record SHA, ownership and dirty state.
   Preserve existing work and create its own task branch/worktree. Never implement
   directly on `main` or take over another agent's worktree without evidence.
2. Read applicable instructions and identify each issue's existing owners before
   editing. Consult [authority](../agent-context/product-authority.md),
   [quality workflow](../agent-context/quality-workflow.md) and
   [validation matrix](../agent-context/testing-and-validation.md).
3. Implement the next unblocked issue completely. Resolve ordinary implementation,
   setup, test and integration problems without repeatedly asking permission.
4. Obtain independent review of substantive changes. If delegates are used, use
   only DeepSeek V4.1 Flash through OpenCode Go. No silent model substitution.
   Review must be performed by a separate reviewer session, not a self-review
   relabeled as independent. Record reviewed revision and dispositions.
5. Open a scoped PR to `main`, fix review blockers, observe required checks at the
   current head, assess integration with current `main`, then merge the verified
   head. Preserve branch protection and required review. Do not enable permanent
   auto-merge or change general Runner merge authority.
6. Sequence additive schema changes and compatible deployments. Verify the target
   identity, pending migration set and recent recovery path before applying SQL.
   Use repository tooling: root `src/db`, `drizzle/`, `drizzle.config.ts` and
   `npm run db:migrate` where appropriate. Inspect the actual command's complete
   pending journal; never run it blindly against a shared target. Do not invent an
   alternate migration history or mark unapplied migrations applied.
7. Record each merge, migration and release result in the delivery ledger below,
   refresh the base and continue. Tool-required waits can yield and resume the
   same assignment; they are not a reason to stop at the first PR.
8. Finish independent issues if an external dependency blocks one. Explain the
   exact missing access/input and affected completion claim. Never invent balances,
   source rows, successful writes or hosted evidence to remove a blocker.

Local secrets may be used privately through existing loaders. Do not commit env
files, tokens, raw financial exports or personal transactions to public artifacts.
Migration permission is distinct from permission to erase historical data.

## 3. Baseline: reuse and defects

These are source findings at the baseline, not claims about the deployed service.

| Existing owner | What to reuse or repair |
| --- | --- |
| `packages/domain/src/expenses.ts` | MAD integer centimes; validation, categories, need/want, payment methods, fingerprints and time windows |
| `packages/application/src/expenses/{service,summary,ports}.ts` | Canonical expense CRUD, replay/conflict behavior, optimistic version and spending summaries |
| `packages/data-access/src/expenses/repository.ts` | Request-scoped Supabase adapter, explicit owner filters and soft delete |
| `packages/contracts/src/expenses.ts`, `packages/api-client/src/expenses.ts`, `apps/server/src/routes/expenses.ts` | Existing HTTP and mobile compatibility |
| `apps/web/src/app/(workspace)/money/` | Manual expense workspace, actions, summary, caps and CSV endpoint |
| `apps/mobile/features/today/quick-actions.tsx` | Existing expense creation; preserve its supported contract |
| `apps/web/src/lib/mcp/` | Permission-aware discovery, authenticated principal, mutation receipts, handlers and personal-ops adapters |
| `src/db/{schema,mcp-schema}.ts`, `drizzle/` | Single schema authority and additive migration journal |

Known blockers and defects:

- Runtime personal-ops permission profiles cannot be issued by the checked-in
  consent choices and stored-grant constraints. Inspect `permissions.ts`, OAuth
  consent, `src/db/mcp-schema.ts` and migration `0057` together.
- Migration `0088` requires `client_id IS NULL` for expense RLS. MCP requires an
  OAuth `client_id`. Existing database proofs intentionally assert OAuth denial.
  Replace that blanket boundary with explicit active-grant permission checks;
  retain denial for unrelated, revoked and ungranted clients.
- The MCP personal-ops summary advertises spending but returns tracked time only.
  List pagination is not fully reachable and owner time context is not resolved
  consistently for dated requests.
- The outer expense mutation receipt omits need/want, note, merchant and payment
  method from its argument hash. A changed request can replay before the full
  canonical fingerprint is consulted. Forbidden writes map to dependency errors.
- Cap progress can show zero after summary failure. CSV has a silent 10,000-row
  ceiling. Edit/delete do not invalidate all affected Today projections.
- The app records expense outflows. It has no complete cash/income/period,
  obligation, money-close, protected-reserve or operating forecast model.

Migration `0092` is the baseline journal tail. Allocate new sequence numbers and
strictly increasing journal timestamps from the current tail when implementing.
Never edit old applied migrations to install new behavior.

## 4. Product rules the implementation must preserve

### One ledger and shared rules

Extend the existing expense journal additively into the canonical money movement
store. Keep existing expense IDs, values, create receipts, versions and deletion
history. Do not create another expense store for MCP, coffee or bill payments.
Policy/calculation belongs in domain/application; contracts own wire shapes;
data-access owns persistence. Web and MCP compose the same use cases. Hono and
typed api-client preserve supported external/mobile behavior.

Use integer centimes throughout: `11.00 MAD = 1100`. Decimal entry must not round
an invalid amount into a different purchase. Aggregation must remain exact and
within supported integer bounds. Unknown payment method stays unknown. Nonexpense
movements do not require invented need/want or spending categories.

Need/want describes an expense independently of whether it is fixed or an
emergency. A subscription can still be a want. Preserve explicit overrides and
factual descriptions. Income, opening cash and savings transfers are movement
kinds, not tricks that turn positive expense amounts into negative numbers.

### Date and period semantics

Expose `localToday`, owner timezone, active tracking date, selected period and
report cutoff separately. Use the owner context, with `Africa/Casablanca` when
configured; do not assume the workbook's `Etc/GMT` is the reporting timezone.

Explicit “today” uses actual owner-local today. Undated routine entries may default
to the configured active tracking date; the receipt states the resolved date.
“Close the day” targets the active date, which may lag today. Store active date
explicitly with versioned period state. Do not derive it solely from max close.
Date-only input must retain a known booking date without claiming a fabricated
purchase instant. Preserve genuine timestamps where known and keep timestamped
legacy clients compatible through explicit versioning/adapters where necessary.

Periods have explicit inclusive start/end dates, including partial months such
as November 9–30. Out-of-period entry must select/create the correct period or
return an actionable error, never silently move dates. Store historical period
settings rather than applying today's targets to every historical report.

### Balances, savings and budgets

Opening cash is represented once. For a report cutoff:

`recorded cash = opening cash + posted inflows through cutoff - posted outflows through cutoff`

The sole opening owner is one canonical ledger movement of kind `opening` per
owner/period, introduced in MONEY-03. Period state references that row and its
provenance, never a second independently editable opening amount. The inflow and
outflow terms above exclude the opening itself. Known zero has an opening row;
unknown opening has none. A source-verified opening and a modeled carry-forward
opening have different provenance and reconciliation status.

Only received income is posted. An unreceived-income request must clarify receipt
or decline posting; no pending-income subsystem is required. Scheduled future bills
are obligations, not cash movements. A date filter must state its cutoff; a lagging active-day report must
not quietly include future-dated records. A current-cash view and active-day view
may differ and must say why. Balance is a recorded model, not bank reconciliation.

Define the tracked account boundary explicitly. A savings transfer out of tracked
spendable cash reduces that cash once. A transfer between accounts already inside
that boundary has no net cash effect. This scope does not require a general
multi-account accounting system. Reversal/correction must restore target funding
and cash consistently.

Protected savings target, actual funded savings, remaining emergency reserve and
forecast closing cash are different fields. Reserve only unfunded savings still
inside spendable cash. Emergency spending reduces its remaining protected reserve;
do not reserve the same consumed emergency money again. Subtract outstanding bills
once. Category allocations describe flexible funds and are not another wholesale
deduction from safe cash. Existing advisory category caps and actual period budget
allocations must have an explicit relationship and distinct labels.

The handoff does not provide the exact `Dashboard!B15` daily-reference formula.
Retrieve it during adoption if possible. Do not claim exact spreadsheet parity
without it. MONEY-08 specifies a documented application fallback and required
invariants so missing workbook access does not stop the whole product build.

### Coffee, bills, close and rollover

Coffee spending and counted visits derive from canonical expense records plus
explicit visit metadata. One counted visit never creates another outflow. Two
items in one visit need not count twice. An explicit coffee-as-groceries override
remains groceries and is excluded from the counted coffee allowance by default.
Coffee allocation consumption uses amounts linked to counted visits; category
coffee totals remain a separately labeled projection, as in the handoff.

Bills and subscriptions are two views of the same obligation occurrences. Only a
posted payment moves cash. A status-only historical annotation must be identified
as such; it must never masquerade as a new payment or silently remove a reserve.
Paying an occurrence links exactly one canonical payment, atomically. Unpaying or
correcting that payment must restore coherent obligation state.

Day close writes a CLOSED note and stores an evidence snapshot. On a nonfinal day
it advances active date once in the same transaction. On the final day it retains
the end date and enters `ended`/rollover-required state. Later corrections remain
allowed; show revised live totals beside the original close. A close does not transfer savings, change
targets, erase entries or automatically carry unused daily allowance forward.

Rollover is explicit. Preserve old periods; create one new opening, copied policy
as requested and fresh dated obligation occurrences. Carryover defaults off.
Generate week windows from dates rather than hardcoded workbook cell ranges.
Historical correction after rollover must reconcile derived successor cash via
the provenance-linked adjustment rule in MONEY-10; frozen close/opening snapshots
must never silently drift or acquire an independently editable duplicate amount.

Every movement has a durable `countsInDaily` flag. Daily included spending is the
sum of expense outflows whose flag is true, independent of category and reserve
funding. Emergency purchases default true as the handoff explicitly requires;
fixed bill payments default false. This daily comparison is not another cash
deduction. It must never be subtracted again from current safe funds.

### Retry, authorization and honest results

Every write uses stable operation identity, full normalized semantic arguments,
canonical create identity where applicable, and version/state preconditions.
Freeze resolved dates/times for retries. An ambiguous response is reconciled with
the original identity; never submit a new purchase to repair missing readback.
Identical legitimate purchases with different identities must remain distinct.

Verified identity selects owner. Preserve request-scoped RLS; no service-role CRUD
shortcut. OAuth policies check active owner/client/resource grant permissions,
including revocation. Read permission never implies write permission. Keep existing
audit, rate limits, write switch and receipt fencing. Broad task/workspace grants
must not accidentally acquire finance permission.

UI and MCP distinguish zero records, unavailable data and incomplete totals.
Reports state currency, dates, timezone, cutoff/as-of and completeness. No success
claim after a failed write. A committed purchase with unavailable analytics is
reported as recorded, with totals explicitly unavailable.

## 5. Issue order and dependency map

Default execution is serial in this order. Dependencies describe what must exist;
they do not authorize stopping after an intermediate milestone. All implementation
issues are autonomous within this contract. Source access/consent can block an
external action, but not unrelated product work.

| ID | Product result | Depends on |
| --- | --- | --- |
| MONEY-01 | Real coffee create/read through permitted MCP and Money | None |
| MONEY-02 | Expense edit/delete, complete reads and honest shared summaries | 01 |
| MONEY-03 | Period setup, opening cash and active-date context | 02 |
| MONEY-04 | Income, savings movements and correct cash balance | 03 |
| MONEY-05 | Budget allocations, category mapping and counted coffee visits | 04 |
| MONEY-06 | Bills and subscriptions managed as shared occurrences | 03, 05 |
| MONEY-07 | Atomic bill payment, correction and reserve coherence | 04, 06 |
| MONEY-08 | Protected reserves and safe daily calculations | 05, 07 |
| MONEY-09 | Durable day close and historical corrections | 08 |
| MONEY-10 | Explicit period rollover without history loss | 09 |
| MONEY-11 | Complete Money dashboard, daily analytics and forecasts | 08, 09, 10 |
| MONEY-12 | Reachable ChatGPT workflows and manual app parity | 01–11 |
| MONEY-13 | Reconciled workbook adoption and repeatable import | 04–12; source data for cutover |
| MONEY-14 | Applied migrations, live release and ready-to-use handback | 01–13; external exceptions explicit |

### MONEY-01: make an authorized MCP coffee purchase real

**Build:** Repair finance consent/grants and RLS, then connect the existing expense
create and summary path to real persisted readback. Include the app result in the
same issue, rather than ending with a discoverable tool that cannot use the DB.

**Code owners:** MCP permissions/discovery/server/principal/read and write handlers;
`apps/web/src/app/oauth/consent/`; `src/db/mcp-schema.ts`; additive `drizzle/`
grant/RLS migration; existing expense application and repository; Money refresh.

**Acceptance criteria:**

- [ ] Consent can issue the existing personal-operations reader and writer profiles
  with exact supported permissions; DB constraints, schema and runtime agree.
  Existing grants are preserved and never silently upgraded.
- [ ] Preserve the one-grant-per-owner/client identity. Offer explicitly consented
  combined workspace-plus-money reader/writer profiles so one ChatGPT connection
  can retain its task/workspace capabilities while accessing Money. Combined
  permissions are the exact advertised union, recorded in constraints, runtime
  and consent; existing workspace grants never gain finance by implication.
- [ ] Writes-disabled consent and tool discovery behave consistently. A finance
  reader can read but cannot create; unrelated profiles cannot access money.
  Audit every write-capable profile, including `task_manager`, `workspace_manager`,
  personal-operations writer and combined profiles. With writes disabled, posted
  consent selections cannot issue a retained write grant: refuse them or offer an
  explicitly labeled compatible read-only choice. Crafted requests obey the same
  decision-service rule; hiding options alone is insufficient.
- [ ] Finance SELECT/INSERT policies permit the matching active OAuth grant and
  retain direct-user behavior. Missing/revoked grants, wrong client/resource and
  cross-owner requests remain denied. Empty RLS results are not used to disguise
  a permission failure that the principal layer can identify.
- [ ] Existing `ega_create_personal_ops_expense` persists 1100 centimes for an
  explicit 11.00 MAD coffee, returns its canonical ID/resolved date/version and
  is visible once on Money after refresh. Unknown merchant/method stay unknown.
- [ ] Full semantic create inputs participate in the outer receipt hash and the
  canonical fingerprint. Same identity/same payload replays; changed note, method,
  need/want, merchant, date, amount or category conflicts rather than mis-replays.
- [ ] Permission errors return an actionable permission result. Missing schema or
  dependencies never become success-shaped responses.
- [ ] The personal-ops summary includes the canonical spending summary alongside
  its existing time information. Owner date/timezone defaults are resolved on the
  server and tool instructions explicitly explain centimes and nullable fields.

**Required proof:** Real disposable DB/OAuth-shaped grant path and same-row app/MCP
readback. Update the existing deliberate OAuth-denial DB proofs to distinguish
grant allow from no-grant deny. Mocks alone cannot establish this issue.

### MONEY-02: complete expense management and trustworthy reads

**Build:** Add MCP get/update/soft-delete and usable pagination. Make Money, Today,
exports and MCP project the same canonical expense state.

**Code owners:** Existing expense services/contracts/repository and Hono/api-client;
MCP registered schemas/handlers/receipts; Money actions/page/export and Today readers;
grant-checked UPDATE policy and immutable-column restrictions.

**Acceptance criteria:**

- [ ] MCP can retrieve, edit and soft-delete an identified expense through existing
  use cases. Edits require expected version; stale edits fail without overwriting.
  Replay after deletion does not recreate a purchase.
- [ ] Update/soft-delete policies check money write permission and preserve owner,
  fingerprint, creation identity, version progression and no-undelete invariants.
- [ ] MCP list exposes reachable continuation with stable ordering and bounded
  filters. All pages can be reached; invalid date/timezone inputs are actionable.
- [ ] Create via MCP, edit manually, read via MCP and delete via MCP operate on the
  same ID. Money and Today invalidate after all relevant writes. Reload/focus
  refresh reveals external writes without requiring a new realtime subsystem.
- [ ] Day/week/month/category/coffee results agree across surfaces for the same
  cutoff. Unavailable or truncated data is visibly unavailable or incomplete,
  including cap progress; it is never displayed as zero complete spending.
- [ ] Money exposes CSV export with supported filters, owner isolation and safe
  spreadsheet cell encoding. Oversized exports are completed through bounded
  paging or explicitly refused; no silent 10,000-row truncation.
- [ ] Existing mobile and HTTP expense callers retain supported behavior and exact
  centime parsing. No new mobile Money screen is required by this contract.

**Required proof:** App/MCP round trip, stale update, paged read, failed-summary
rendering and export completeness through the real affected boundaries.

### MONEY-03: configure a period, opening cash and active date

**Build:** An owner can initialize/select a money period and see the active tracking
context in Money or MCP. Existing users do not acquire an invented opening balance.

**Code owners:** Add money domain/application ports, contracts and repository beside
existing expense owners; root schema/journal; Money setup/settings; MCP state and
versioned settings operations. Use concrete modules, not a generic workflow engine.

**Acceptance criteria:**

- [ ] Durable period state has owner, inclusive date range, currency, timezone
  context, active date, version and initialization/provenance state. Invalid or
  overlapping active periods are rejected with a defined historical-read path.
- [ ] Lifecycle is `tracking`, `ended` or `rolled_over`. Initialization is
  `uninitialized` without an opening, `initialized` with a modeled opening, or
  `reconciled` with recorded verified source/cutoff evidence. These labels never
  claim a bank check without evidence. Only a tracking period accepts routine new
  entries; ended/rolled-over periods use explicit historical correction paths.
- [ ] This issue introduces the single ledger `opening` kind, unique per owner and
  period, with provenance and correction history. Known zero is allowed for this
  kind; normal expenses remain positive. The period stores its opening reference,
  not a duplicate amount. An opening of zero is distinct from an unknown opening.
  Expense-only accounts display cash as unknown until initialized/reconciled.
- [ ] Web setup/settings and MCP expose the same create/read/update rules, including
  explicit state/version preconditions. Changing active date does not change the
  period boundaries, close a day or reset transactions.
- [ ] Both surfaces show actual local today and active date; explicit today and
  active-day requests resolve correctly when they differ.
- [ ] Legacy timestamped expense rows retain their IDs/values. Their period/date
  assignment is deterministic and reviewable; ambiguous historical mappings are
  surfaced rather than silently claimed reconciled.
- [ ] Partial periods work; out-of-period entries receive an actionable response.
  New configuration and its policies are owner-isolated for direct and MCP access.

**Required proof:** Empty account, existing expense account, partial period and
lagging active date through manual setup and MCP state/settings operations.

### MONEY-04: record income and savings movements in one ledger

**Build:** Extend the journal to real cash movements and expose manual/MCP movement
management while retaining the existing expense path.

**Code owners:** Expense/money domain and application, DTOs, repository queries,
root schema/constraints/grants, Money ledger/forms and MCP movement handlers;
affected Hono/api-client consumers and weekly-review summaries.

**Acceptance criteria:**

- [ ] Journal kind/direction distinguishes expenses, received income, opening and
  actual savings transfers, extending MONEY-03's existing opening kind rather
  than creating another opening owner. New kinds have valid typed fields without
  fictional expense categories or need/want classifications.
- [ ] `countsInDaily` is persisted and carried through shared DTOs, HTTP, web and
  MCP create/update/read contracts, normalized fingerprints and mutation receipts.
  Ordinary expenses, including emergency, default true; opening, received income,
  savings transfers and reconciliation adjustments default false. Fixed-payment
  defaults are defined in MONEY-07. Explicit owner overrides remain durable.
- [ ] Existing expenses backfill true unless verified source evidence supplies a
  different flag. Import preserves Ledger J exactly. Report migrated defaults as
  defaults, not recovered historical facts. An excluded 11.00 expense still lowers
  cash and increases expense totals by 11.00, with daily included spending 0.00.
- [ ] Manual and MCP create/read/update/correction paths share parsing, owner scope,
  stable create identity and optimistic concurrency. Date-only booking retains
  uncertainty about occurrence time; timestamped clients remain supported.
- [ ] Existing expense lists/summary queries deliberately filter or project kinds;
  income, opening and savings transfers do not inflate expense, caps or coffee.
- [ ] Opening 500.00 + received income 200.00 - coffee 11.00 gives recorded cash
  689.00 MAD and expense spending 11.00 MAD at the same cutoff. Unreceived income
  creates no posted movement. Running balances remain explained after backdating.
- [ ] The tracked spendable-cash boundary is recorded. A real savings transfer out
  reduces cash once and increases actual funded savings once. A target edit does
  neither. Corrections restore the same invariants.
- [ ] Movement reads state cutoff, period, provenance and completeness. Unknown
  opening or incomplete history prevents a falsely confirmed cash balance.

**Required proof:** Same movements viewed/edited through both surfaces, backdating,
replay/conflict and legacy spending-summary compatibility.

### MONEY-05: budgets, category adoption and coffee visits

**Build:** Editable period budget allocations and coffee limits, with correct
category reporting and counted visits derived from the same outflows.

**Code owners:** Money policy domain/contracts/application, allocations and visit
metadata persistence, category constants/checks/caps validators, web forms/analytics,
MCP allocation/category/visit operations and affected expense callers.

**Acceptance criteria:**

- [ ] Publish one explicit mapping for handoff Start, Transport, Food, Daily usage,
  Coffee, Bill, Income, Saving, Personal care, Work/tools, Fun, Emergency and Other.
  Movement kinds own nonexpense meanings; preserved reporting detail prevents
  silently collapsing every unsupported category into indistinguishable “other”.
- [ ] Existing category values remain compatible. Required taxonomy additions or
  reporting dimensions update schema checks, domain/contracts, caps validation,
  web/mobile selectors and reports together without reclassifying old rows.
- [ ] Period allocations, savings/emergency targets and coffee spend/visit limits
  can be viewed and explicitly edited in web and MCP with versions. Routine
  spending never automatically changes the budget or target.
- [ ] Existing advisory caps have clear labels and migration/precedence. One value
  is not maintained independently in two editable owners under the same meaning.
- [ ] A counted coffee visit references canonical spending and is unique/replayable.
  An ordinary coffee increments the appropriate visit once. Multiple purchase
  lines can belong to one visit without multiple cash effects or inflated visits.
- [ ] “Coffee, classify as groceries for testing” preserves the description/override,
  increases groceries spending and leaves counted coffee usage unchanged.
- [ ] Coffee weekly windows derive from owner-local dates and period boundaries;
  counts, spend, remaining allocation and limit overshoot are distinct values.
  Allocation consumption follows counted-visit amounts; uncounted category-coffee
  purchases remain visible in separately labeled category spending.

**Required proof:** Normal visit, multi-line visit, explicit override, category edit
and partial-week allocation through shared reads and both editing surfaces.

### MONEY-06: manage bills and subscriptions as obligation occurrences

**Build:** Manual and MCP management of due obligations without pretending a
scheduled bill is already paid.

**Code owners:** Money obligations domain/application/contracts/adapter and schema;
Money bills/subscriptions views/forms; MCP obligation discovery and management.

**Acceptance criteria:**

- [ ] One durable occurrence owns amount, due date, period, kind (bill/subscription),
  description, version and explicit lifecycle. Recurring templates are separate
  from generated occurrences and do not themselves post cash movements.
- [ ] Templates supply classification defaults; each occurrence snapshots its own
  need/want (unknown allowed until payment), purpose (fixed/flexible/emergency) and
  `countsInDaily`. Payment input overrides occurrence snapshot, which overrides
  kind defaults. An unknown required expense classification is requested, never
  fabricated. Editing a template does not rewrite occurrence classification.
- [ ] Bills and subscription views project the same occurrence ID/payment state;
  they never maintain two independent paid flags for one obligation.
- [ ] Web and MCP can create, list, inspect, edit and cancel/waive an occurrence
  explicitly. Scheduling or cancellation has no cash movement. Cancellation and
  waiver follow the lifecycle table below, with versioned transitions and effective
  dates retained for historical and start-of-day reconstruction.
- [ ] A paid state requires a valid owner-safe linked payment, except explicitly
  flagged reconciled historical evidence handled by import. A bare status change
  cannot silently manufacture cash history or claim a payment.
- [ ] Due, overdue and outstanding totals use complete occurrences at the selected
  cutoff. Editing a recurring template does not rewrite previous occurrences.
- [ ] The initial supported payment rule is one full payment per occurrence;
  partial/overpayment is rejected clearly rather than falsely marked fully paid.

| Occurrence state | Outstanding reserve | Cash effect and allowed transition |
| --- | --- | --- |
| `pending` | Full amount | None until payment; due/overdue are date-derived views |
| `paid` | Zero | Linked ledger payment only; undo through atomic correction to pending |
| `waived` | Zero | Owner explicitly forgoes obligation; no payment; reopen to pending restores reserve |
| `cancelled` | Zero | Owner explicitly removes obligation; no payment; reopen to pending restores reserve |

Paid occurrences cannot be waived/cancelled while silently retaining or deleting
the payment link. Resolve the linked payment through MONEY-07 first. Historical
import annotations preserve source evidence and disclose missing payment history.

**Required proof:** Same occurrence in both views, date/amount edit, recurrence
identity, owner isolation and no cash effect from schedule/status-only actions.

### MONEY-07: pay or correct an obligation atomically

**Build:** A manual or MCP “pay this bill” commits one payment and one coherent
obligation transition, including retries and subsequent corrections.

**Code owners:** Canonical payment use case/transaction port, authenticated DB
transaction/RPC and grants, ledger and obligation repositories, web action and MCP
mutation. Do not try to simulate atomicity with two independent client writes.

**Acceptance criteria:**

- [ ] Payment validates expected occurrence version, actual amount/date and grant;
  inserts one outflow and links the occurrence in one transaction. Any failure
  leaves neither half committed. Auth identity is derived inside the DB boundary.
- [ ] Retry or concurrent payment returns the original result or a useful conflict;
  different operation IDs cannot pay an already-paid occurrence twice.
- [ ] Fixed payments normally exclude flexible daily spending, but still reduce
  cash and total expense spending. Need/want is retained independently from fixed
  purpose using the configured obligation classification or explicit input.
  Persist the resolved `countsInDaily` on the payment, default false for fixed
  purpose; an explicit payment override wins. A fixed subscription can be a want.
- [ ] Paying X reduces cash by X and outstanding reserve by X once. Bills and
  subscription views agree immediately after refresh.
- [ ] Correcting/deleting a linked payment uses an explicit shared correction path;
  generic expense editing cannot orphan the occurrence. Correcting amount/date or
  undoing payment restores coherent cash, reserve and status in one transaction.
- [ ] Cross-owner payment links and reuse of one payment for two occurrences are
  rejected by persistence constraints, not merely hidden in the UI.

**Required proof:** Real transaction rollback, retry/concurrent payment and payment
correction, read through Money and MCP against the same stored IDs.

### MONEY-08: calculate protected reserves and safe daily spending

**Build:** Shared operating calculations with explicit inputs and a published
daily-reference algorithm, visible in Money and MCP.

**Code owners:** Pure money calculation module, application read model and repository
aggregates, policy contracts, Money reserve/reference cards and MCP analytics.

**Acceptance criteria:**

- [ ] Reports expose recorded cash, unpaid commitments, target savings, actual
  funded savings, unfunded protection and remaining emergency reserve separately.
  Safe flexible funds subtract only disjoint outstanding reserves from cash.
- [ ] With cash 689.00, unpaid bills 100.00, unfunded savings 200.00 and unused
  emergency 50.00, safe flexible funds are 339.00 MAD. A 100.00 reserved bill payment
  leaves safe flexible funds 339.00. A 200.00 savings transfer that funds the target
  also leaves 339.00, rather than deducting savings twice.
- [ ] Emergency usage reduces the still-protected emergency amount consistently.
  Negative safe funds and category overruns remain visible; no silent clamp hides
  a deficit. A spend recommendation may separately floor its recommendation at 0.
- [ ] Retrieve the workbook B15 formula and representative inputs if available.
  Record the resulting algorithm/version and any discrepancy with the handoff;
  never copy a formula that demonstrably double-subtracts a movement unnoticed.
- [ ] If B15 remains unavailable, ship a documented application method: reconstruct
  safe funds at the start of the selected active day, divide by remaining inclusive
  days, floor the nonnegative allowance to centimes, then subtract that day's
  `countsInDaily=true` expense outflows once. Show current safe funds separately.
  Identify this method and do not claim exact workbook formula parity.
- [ ] The fallback uses the following versioned inputs for selected date `d`:
  `C0 = opening + signed nonopening movements booked before d`;
  `U0 = outstanding commitments at the day-start lifecycle cutoff`;
  `S0 = max(0, day-start savings target - net savings funded before d)`;
  `E0 = max(0, day-start emergency target - qualifying emergency usage before d)`;
  `F0 = C0 - U0 - S0 - E0`;
  `N = max(0, periodEnd - d + 1)` in calendar days;
  `referenceMinor = floor(max(0, F0Minor) / N)` when N is positive;
  `dailyRemaining = reference - daily included expense outflows`.
  Keep negative F0 visible. The initial period baseline includes the recorded
  opening, configured targets and initial obligation snapshot, even when setup
  happens during its first day. Unknown historical inputs produce an unavailable
  baseline, not a zero or an invented lifecycle history.
- [ ] Policy revisions and obligation transitions have effective dates and retained
  versions sufficient to reproduce the baseline. Same-day income immediately
  improves current cash/safe funds but enters the default reference next day.
  Midday target changes affect current reserves immediately; the day-start
  reference remains fixed unless the owner explicitly rebases it, recording a new
  baseline/version. Current bill payments and savings funding release their
  matched reserves once. Closing snapshots the chosen baseline and inputs.
- [ ] A start-of-day flexible pool of 100.00 over 10 days gives reference 10.00;
  spending 11.00 gives daily remaining -1.00, not a second reduction of the reference
  by the same 11.00. Historical corrections show restated day-start inputs beside
  the original at-close baseline where they differ.
- [ ] With start-of-day cash 689, bills 100, savings protection 200, emergency 50
  and 10 days, reference is 33.90. An emergency expense of 50 with daily flag true
  leaves cash 639, emergency protection 0 and current safe funds 339; daily included
  spend is 50 and daily remaining -16.10. This overshoot is a daily comparison,
  never a second cash deduction. Excluding that row explicitly changes daily spend
  only. A fixed payment with flag false leaves daily included spend unchanged.
- [ ] Cutoff/date, denominator, rounding, carryover-off rule and incomplete/unknown
  inputs are explicit. Zero remaining days yields a defined no-days-left result,
  never divide-by-zero or a fabricated daily allowance.
  Ended/rolled-over periods expose historical daily results but no new-day spend
  allowance, even though their last tracking date remains the inclusive end date.

**Required proof:** Hand-calculated synthetic values above plus emergency use,
funding reversal, lagging date and incomplete-data responses from both surfaces.

### MONEY-09: close a day while preserving correction history

**Build:** Money close controls and MCP close operation with durable note/snapshot
and atomic active-date advancement.

**Code owners:** Money day-close use case/contracts/transaction adapter and schema,
Money daily view/close form, MCP close tool and receipt handling. Do not reuse the
unrelated routine `daily_checkins` row as the money-close owner.

**Acceptance criteria:**

- [ ] Close validates expected period/version/active date, complete inputs and all
  final purchases included in the request. Purchases are recorded with stable
  identities before the close transition; a failed item prevents closing over an
  unrecorded purchase, and already committed items remain explicitly recoverable.
- [ ] One transaction stores owner/period/date, CLOSED note, category/flexible totals,
  cash/reference/reserve snapshot, algorithm/policy version and close identity,
  then advances active date one calendar day only for a nonfinal day. The final-day
  transaction retains `activeDate = period.endDate`, marks it the last tracked date
  and changes lifecycle to `ended`/rollover-required. No state changes on failure.
- [ ] Replay/concurrent close returns the same close or a stale-state conflict;
  active date cannot advance twice. A lagging active date is not replaced by today.
- [ ] Closing the last period day leaves an explicit period-ended/rollover-needed
  state; it does not silently create a new period. A distinct-date close request
  validates context and cannot silently skip unclosed active days.
  Further routine purchases require rollover or explicit historical correction;
  no invalid active date outside the period is stored.
- [ ] The next day displays its existing entries if any, otherwise zero recorded
  spending. Close does not alter savings, budgets or carryover policy.
- [ ] Historical corrections remain possible through normal versioned operations.
  Original close evidence is retained; revised live totals and a changed-since-close
  indicator are visible in web and MCP.
  After rollover the MONEY-10 correction rule also applies; a generic edit cannot
  bypass downstream cash reconciliation.

**Required proof:** Final purchase failure, atomic close rollback, duplicate close,
last-day boundary and later corrected expense with original snapshot retained.

### MONEY-10: roll over explicitly to a new period

**Build:** A manual/MCP rollover operation that retains old periods and prepares
the next period without duplicating money or recurring bills.

**Code owners:** Money rollover use case and authenticated transaction, period and
obligation persistence, contracts, Money period selector/rollover UI and MCP tool.

**Acceptance criteria:**

- [ ] Explicit rollover validates source version, chosen new dates and unresolved
  items. It returns an actionable choice for unpaid bills/unknown closing cash;
  it does not invent a reconciled balance or silently drop obligations.
- [ ] A closing reconciliation compares linked paid obligations to payments,
  counted visits to ledger amounts, close snapshots to restated totals, and
  forecast savings to actual transfers. If a verified cash snapshot is supplied,
  compare modeled closing cash to it. A bank connection is not required.
  Differences are resolved or explicitly accepted with provenance before rollover;
  modeled/unreconciled carry-forward remains labeled as such. Unknown is not zero.
- [ ] Exactly one new period and opening are created atomically. Carry-forward
  cash is one opening, never both an opening and duplicated income. A supplied
  reconciled opening difference is recorded with provenance.
- [ ] The owner can explicitly choose policy copy and treatment of unpaid items.
  Paid state and old transaction rows are never copied as new expenses. Generated
  occurrences have unique source/period identities and correct new due dates.
- [ ] Retrying/concurrent rollover cannot create duplicate periods, openings or
  occurrences. Failures preserve the original source period state.
- [ ] Source lifecycle becomes `rolled_over` with one successor link. The new
  tracking period starts at its chosen start date; initialization/provenance follows
  MONEY-03. The successor opening is a frozen snapshot of the accepted source
  closing balance or an independently verified balance, with its cutoff recorded.
- [ ] A later correction to a pre-cutoff source movement preserves frozen close
  and opening snapshots. In one owner-safe compound operation, post the net cash
  delta as a provenance-linked `reconciliation_adjustment` in each affected derived
  successor. It is neither income nor expense and defaults `countsInDaily=false`.
  Deltas propagate through derived carry-forward periods and stop at an
  independently verified opening covering that cutoff; disclose the historical
  variance there without altering that verified snapshot. Post-cutoff corrections
  do not bridge a balance that never included them.
- [ ] Bridge identity includes source correction/version and destination period;
  retries never duplicate it. Repeated edits apply only the incremental delta.
  A downstream version conflict rolls back the compound correction and reports
  the required retry; never return corrected success with inconsistent cash.
  Example: carried opening 689 stays 689; changing a prior expense from 11 to 21
  restates source closing to 679 and posts a -10 successor bridge, making successor
  cash 679 before new spending. All affected close snapshots remain retained.
- [ ] Old ledger, closes, settings and reports remain selectable. Original evidence
  remains unchanged; explicit corrections produce clearly labeled restated views.
  Carryover allowance stays off unless explicitly configured; period cash opening
  is not confused with daily allowance carryover.
- [ ] Partial periods, month length and local date boundaries produce valid dates
  and regenerated coffee week windows without hardcoded workbook ranges.

**Required proof:** Repeated rollover, unpaid-item choice, unknown closing cash,
partial-to-full period and historical report readback.

### MONEY-11: finish operating analytics and the Money dashboard

**Build:** The complete manual operating view with shared MCP analytics, including
daily/category trends, protected cash, commitments and clearly labeled forecasts.

**Code owners:** Canonical money analytics read model/aggregates/contracts, Money
dashboard/history/drilldowns/export and MCP analytics handler; affected Today and
weekly-review consumers. Avoid copying arithmetic into charts or handlers.

**Acceptance criteria:**

- [ ] Money shows cash with cutoff/provenance, active date/period, received income,
  total and flexible spending, daily reference/remaining, savings/emergency,
  unpaid bills, category allocation remaining and counted coffee usage.
- [ ] Daily series cover the actual period dates, including zero-record days;
  category breakdown, high-spending days, need/want and fixed/emergency context,
  week/period progress and coffee history drill into canonical entries.
- [ ] MCP and UI consume the same analytics contract and values for the same
  owner/period/cutoff. Charts, exports and headline cards use matching filters.
- [ ] Forecast closing cash, savings feasibility and coffee projection state model,
  actual coverage, elapsed/remaining days, assumptions and policy version. Sparse
  history warns or declines projection; unreceived income is never confirmed cash.
- [ ] Actual funded savings and target/forecast are visually and semantically
  separate. A forecast is never described as money already saved or bank-verified.
- [ ] Empty, uninitialized, partial and dependency-error states are usable and
  truthful. Expensive reads remain bounded; summary completeness is explicit and
  required close/rollover calculations cannot use a truncated sample.
- [ ] The dashboard supports period selection and entry/obligation drilldowns;
  relevant mutations refresh all affected projections and exports consistently.

**Required proof:** Shared dataset read through both surfaces, partial-month trend,
sparse forecast, unavailable totals and post-mutation refresh.

### MONEY-12: complete ChatGPT workflows and manual parity

**Build:** Finish tool discoverability, schemas, descriptions, result contracts and
app navigation so every shipped operation is reachable and understandable.
This issue fixes integration gaps; it does not defer MCP for earlier issues.

**Code owners:** MCP server/discovery/permissions/tool descriptions/schemas/error
mapping and capability docs; Money navigation/forms/actions; shared contracts.

**Acceptance criteria:**

- [ ] Reader discovery exposes money state, paged ledger/get, obligations, budgets,
  closes and analytics. Writer discovery exposes expense/movement CRUD, explicit
  settings/allocation changes, obligation management/payment/correction, close and
  rollover. Existing tool names remain compatible or have a working migration path.
- [ ] Every tool calls a canonical use case and authenticated repository. No tool
  is a stub, independently maintained financial calculator or unguarded SQL proxy.
- [ ] Clear ordinary requests need no extra purchase confirmation. Descriptions
  explain amount units, nullable unknowns, date defaults, expected versions,
  operation identity and when a material ambiguity needs clarification.
- [ ] “11 coffee and 25 chicken” records two independent purchases and reports
  each result. Two separate identical coffees remain two legitimate purchases.
  A failed item is explicit; successful items are not silently rolled back or
  duplicated during retries. A batch tool is optional, not a new framework.
- [ ] Readback reports stored amount, resolved date, ID and available relevant
  totals. Lost-response recovery preserves original IDs/dates. A stored write
  followed by analytics failure is not resubmitted as a new purchase.
- [ ] Each money operation also has an accessible manual Money path, including
  initialization, correction, bills, targets, close and rollover. Responsive
  web controls show validation, loading, empty, error and success states.
- [ ] No finance data leaks into unrelated task context, logs or broad capabilities.
  Read-only/revoked connections remain denied writes after a consent refresh.

**Required proof:** Actual MCP transport discovery and representative tool calls,
paired with manual workflows on the same records; source descriptions alone fail.

### MONEY-13: reconcile and adopt existing workbook data

**Build:** A bounded, repeatable importer and adoption flow that reconcile the old
tracker with existing EGA rows before the app becomes the sole financial writer.

**Code owners:** A scoped import adapter/command and canonical application import
use case, provenance schema/contracts, reconciliation output and Money adoption
status. Reuse canonical writes/validated transaction boundaries; no unscoped CRUD.

**Acceptance criteria:**

- [ ] Discover the actual source through the available Google Drive/Sheets tools
  or a verified owner export. The handoff intentionally omits current balances
  and rows. Do not fabricate them or seed the live owner with synthetic examples.
  Verify workbook metadata; the historical August template remains untouched.
- [ ] Dry run maps ledger in/out, opening, dates, classifications, daily inclusion,
  coffee visits, bill/subscription links, settings, budgets and CLOSED notes.
  Preserve unknowns and explicit category overrides. Document formula parity or
  the declared daily-reference difference from MONEY-08.
- [ ] Import uses stable source/row identities and a frozen source snapshot or
  equivalent manifest, not date/amount hashes or mutable row numbers alone.
  Existing EGA entries are matched/reconciled before any insert; unresolved matches
  require a decision rather than silently deleting or duplicating purchases.
- [ ] Choose full-history import or a verified cutover opening plus retained
  historical evidence. Never count both a historical opening and its accumulated
  prior movements again. A cutover snapshot makes reporting coverage explicit.
- [ ] Reconciliation accounts for row counts, income/outflow, day/category totals,
  closing cash, unpaid obligations, visits and closes. Differences must be zero
  or specifically accepted; unknown amounts are not treated as accepted zeros.
- [ ] Apply only the reviewed reconciliation manifest to the verified owner/target.
  Repeating the same import creates no new movements or payments; interruption
  resumes from durable provenance. Corrections are traceable and non-destructive.
- [ ] Record cutover time/source and designate EGA House as the sole writer. Keep
  the workbook historical; do not dual-write or delete source data. If access is
  unavailable, finish importer/setup and label real-data adoption blocked. Continue
  independent release work without claiming personal history reconciled.

**Required proof:** Synthetic importer behavior in isolated data plus actual
sanitized reconciliation evidence for any real cutover claim. Personal rows stay
outside Git, issue comments and generic logs.

### MONEY-14: release the complete system for direct use

**Build:** Execute the scoped operational rollout, correct deployment/configuration
gaps and hand back live Money and MCP entry points with observed evidence.

**Code owners:** Required Money/MCP migrations, existing environment/deployment
configuration and release documentation. Update relevant living contracts and
runbooks; do not rewrite historical reports as if they described the new release.

**Acceptance criteria:**

- [ ] MONEY-01–12 are merged and all deployable MONEY-13 product code is merged.
  Actual import status is explicit. Required checks and independent review are
  recorded for each current integrated revision, with no unresolved blockers.
- [ ] Verify the EGA House project/database identity against deployed app config,
  current migration history and intended environment. A credential's existence
  is not target proof. Enumerate pending migrations and isolate unrelated changes.
- [ ] Confirm recovery/backup and additive upgrade compatibility before the first
  hosted write. Apply the reviewed pending Money/MCP set through the supported
  repository path; record versions and verify tables, checks, grants, functions,
  RLS, existing-row preservation and post-migration readability. Re-running delivery
  reconciles the journal instead of reapplying effects blindly.
- [ ] Observe the exact main revision deployed to the web/MCP project and affected
  Hono project. Preserve main-only deployment; no fabricated preview requirement.
  Required feature switches are configured using existing authorized tooling,
  without rotating secrets or upgrading grants silently.
- [ ] Fresh/updated OAuth consent can issue the finance profile and actual tools
  are discoverable. If connector re-consent must be performed by the user, provide
  the exact action and mark that acceptance step pending; do not impersonate them.
- [ ] An authenticated app/MCP journey records and reads the same canonical data,
  covers expense edit/delete, income/balance, obligation payment, analytics, close
  and rollover in isolated test-owner data. Never contaminate the owner's real
  ledger with acceptance purchases or synthetic opening cash.
- [ ] Hosted denial/revocation boundaries are verified with permitted test identities
  and real request-scoped RLS. A health check or mocked harness alone is insufficient.
- [ ] Handoff includes actual Money URL, MCP connection/consent instructions,
  deployed SHA(s), migration versions, supported actions, adoption status and any
  precise external action still needed. “Ready for direct use” is reserved for the
  observed working app and connector, not merely merged source.

**Required proof:** Exact deployment and migration evidence plus authenticated
runtime outcomes. Keep release stages separate if any external step is blocked.

## 6. Required implementation evidence

Acceptance checkboxes above describe code and durable product behavior. Each issue
also needs proportionate evidence for its changed boundaries:

- Start with a narrow reproduction/regression for an existing defect. Run affected
  domain/application/data-access/contracts/HTTP/web tests and type checks; preserve
  mobile compatibility when shared contracts or decimal parsing change.
- Use real disposable Postgres/Supabase for RLS, active/revoked grants, constraints,
  migration upgrades, receipts, concurrent payments/closes and rollback. Amend the
  existing deliberate OAuth-denial proofs intentionally, retaining negative cases.
- Run required `ci:security`, architecture and integration gates for affected
  changes. Root test/typecheck/build scripts cover web only; inspect workspace
  scripts and the validation matrix. Use VM `heavy` rules for resource-heavy work.
- Exercise Casablanca boundaries, active-date lag, exact decimals, replay with
  changed semantic fields, independent identical purchases, cutoff consistency,
  incomplete analytics and stable export paging where affected.
- Record independent review, exact-head checks, merge SHA, target migration state,
  deployment revision and observed runtime separately. Do not use green mocks or
  an agent's completion message as proof of a hosted authorization boundary.

Do not create test-only tickets to stand in for a missing feature. Supporting
checks belong with the issue that changes the behavior. Do not broaden repeated
testing after required checks pass unless a new change or unresolved concern
justifies it.

## 7. Final user acceptance script

Use isolated acceptance data first. After source adoption, the owner can perform
these same actions with real intended financial entries. Do not automatically add
these synthetic examples to the owner's account.

| User action | Expected visible result |
| --- | --- |
| Open Money / ask “what day are we tracking?” | Same period, active date, actual today, timezone and initialization status |
| “Spent 11 on coffee today” | One 11.00 MAD expense, resolved local date, one counted visit and matching app/MCP totals |
| Repeat an interrupted request | Original purchase returned once, no extra cash effect |
| “11 coffee and 25 chicken” | Two separate purchases, each outcome explicit |
| “Coffee under groceries for testing” | Groceries reporting and preserved override; no counted coffee visit |
| Edit in Money, then ask ChatGPT to show it | Same ID with updated version/amount and refreshed totals |
| Ask ChatGPT to remove the mistaken entry | Soft-deleted once; app, cash, coffee and reports agree |
| Opening 500, income 200, expense 11 | Cash 689 and spending 11; opening/income do not inflate spending |
| Create a bill, then pay it | One occurrence and one payment; cash and unpaid commitments change once |
| Change savings target, then record a transfer | Target edit moves no cash; actual transfer is separate and never double-reserved |
| Ask “what can I spend?” / open analytics | Same safe-funds calculation, category remaining and clearly labeled forecast |
| “Close the day” with a lagging active date | Correct date's CLOSED snapshot; one advance; no budget or savings mutation |
| Correct a closed day's entry | Original close retained, revised live totals explicitly shown |
| Start the next period | One new opening/policy/occurrence set; historical period still readable |
| Revoke writer permission | Subsequent writes denied; no stale grant or service-role bypass |

## 8. Delivery ledger and resumption

Update this table as work progresses; link real PRs and sanitized evidence. Do not
check acceptance based on intent. Additional detailed receipts can live in a linked
delivery report; never include credentials or private source exports.

| Issue | State | PR / head / merge SHA | Migrations / runtime evidence | Remaining blocker |
| --- | --- | --- | --- | --- |
| MONEY-01 | Merged | PR #392 / reviewed `c491e50b` / merge `70a1709a` | Migrations `0089`–`0092` (pre-existing pending) and `0093_money_01_finance_grants` applied to the verified Supabase target; grant/check-in RLS and both DB proofs pass locally and in `db-invariants` | Runtime OAuth/MCP same-row readback awaits the real connector at MONEY-14 |
| MONEY-02 | Merged | PR #393 / reviewed `aa8793b7` / merge `c0a5d0fe` | `0094_money_02_expense_management` applied after merge; RLS/API proofs pass on disposable PostgreSQL 18 | Snapshot-safe keyset export added in `29272f7a`; runtime UI journey remains MONEY-14 |
| MONEY-03 | Merged | PR #394 / merge `9ed51d53` | `0095_money_03_periods` is in the `0089`–`0096` set reported applied to the verified Supabase target; periods/openings proof passes on disposable PostgreSQL; hosted journal is re-verified at MONEY-14 | Runtime app/MCP period journey remains MONEY-14 |
| MONEY-04 | Merged | PR #395 / merge `c6a5414f` | `0096_money_04_movements` is in the same reported applied set; movement/API proofs and the disposable authenticated Money journey pass | Runtime host/income/savings journey remains MONEY-14 |
| MONEY-05 | Merged | PR #396 / merge `0c28a6ce` | `0097_money_05_budgets_coffee` applied through `npm run db:migrate` to the verified Supabase target (journal max `1787880000060`); schema/RLS/grants/functions re-read; web and server production deployments READY at `0c28a6ce`; DB proof, disposable authenticated Money journey, package/web/server suites and lint pass | Runtime OAuth/MCP coffee journey remains MONEY-14 |
| MONEY-06 | In review | PR pending / branch `feat/money-06-reconcile` | `0098_money_06_obligations` committed, not applied; obligation recurrence/lifecycle/payment-link/RLS proof passes on disposable PostgreSQL 16 and is wired into `db-invariants` | PR checks and independent review; migration apply follows merge |
| MONEY-07 | Planned | — | — | — |
| MONEY-08 | Planned | — | — | Exact workbook B15 formula not supplied |
| MONEY-09 | Planned | — | — | — |
| MONEY-10 | Planned | — | — | — |
| MONEY-11 | Planned | — | — | — |
| MONEY-12 | Planned | — | — | — |
| MONEY-13 | Planned | — | — | Live source values/access not verified |
| MONEY-14 | Planned | — | — | Hosted configuration/consent not verified |

On resumption, re-read this contract and ledger, fetch current `main`, inspect
open work/PRs and verify migrations/deployments before creating new effects. The
standing authorization remains scoped and valid until completed MONEY-14 handback
or user revocation, as recorded in AGENTS.md.
Continue to the full completion boundary; do not ask whether to proceed after
each issue.

## 9. Sanitized handoff reference

Source: the user-supplied `MONEY_TRACKER_OPERATING_HANDOFF.md`, attachment reference
`file_85cdbfc8-6b46-4bc7-b66c-9cc63b9edba8`, reviewed against the source baseline
above. This appendix preserves the operating contract without workbook IDs,
credentials, balances or transaction rows. Source statements about verified
spreadsheet formulas are handoff evidence, not a fresh hosted verification.
MONEY-13 must still obtain actual data and inspect current workbook metadata.

### Source inputs and calculated views

| Workbook tab | App responsibility |
| --- | --- |
| Ledger | Canonical dated money movements; one cash effect per movement |
| Fixed Bills | Obligation occurrences, due amounts and linked payments |
| Subscriptions | Subscription view of those same occurrences |
| Coffee | Counted visit metadata linked to canonical expense amounts |
| Settings | Period, opening provenance, active date, protection and limits |
| Budget Plan | Editable policy allocations plus derived consumption/remaining |
| Daily Tracker | Daily included spending, reference, remaining and close notes |
| Dashboard | Shared operating analytics |
| Visual Dashboard | Charts/alerts from the same analytics |
| Category Analysis | Category totals and drilldowns |
| Flexible Analysis | Included spend, need/want, trends and labeled forecasts |
| Savings | Target, actual funding, emergency protection and forecast gap |
| Monthly History | Preserved periods, settings, closes and reconciliation |

The 13 tab names describe responsibilities, not 13 new database tables or routes.
Observed worksheet row bounds are not product record limits. The old August
template must remain untouched; a workbook copy has its own identity and metadata.

### Ledger A:J mapping

| Source column | Durable meaning in EGA House |
| --- | --- |
| A Date | Owner-local booking date; retain genuine timestamp only when known |
| B Category | Mapped category/reporting classification, preserving explicit overrides |
| C Description | Actual user-described purchase/payment, not a generated merchant |
| D Money In | Received inflow or the unique opening; never pending income |
| E Money Out | One outflow, typed as expense or actual savings transfer |
| F Balance | Derived running cash; never imported as an extra cash movement |
| G Need/Want | Need/want plus independent fixed/emergency purpose or movement kind |
| H Payment Method | Cash, Card, Bank map to cash, card, bank_transfer; Unknown maps to null |
| I Notes | Owner notes, clarification, explicit override and retained source evidence |
| J Counts in Daily? | Durable boolean controlling included daily outflow totals |

Opening rows cannot also become income. A source row containing both in and out,
or conflicting opening evidence, requires explicit reconciliation instead of a
silent guessed interpretation. Import retains original source classifications
without forcing `Fixed`, `Income`, `Saving` or `Emergency` into need/want.

### Required category and intent mapping

| Source label | Canonical meaning / reporting requirement |
| --- | --- |
| Start | Opening movement, no expense consumption, daily false |
| Income | Received income movement, daily false |
| Saving | Actual savings transfer movement when supported by source, daily false |
| Transport | Existing transport expense category |
| Food | Groceries by default; eating_out only when the source establishes it |
| Coffee | Coffee expense plus explicitly counted visit metadata |
| Bill | Bills or subscriptions from known obligation kind, fixed purpose by default |
| Daily usage | Household/consumables, retaining a distinct daily_usage reporting group |
| Personal care | Distinct personal_care reporting group |
| Work/tools | Distinct work_tools reporting group |
| Fun | Distinct fun reporting group |
| Emergency | Distinct emergency reporting group/purpose; daily true by default |
| Other | Other expense, preserving description and known need/want |

MONEY-05 may extend the category enum or use a typed reporting dimension, but must
implement these distinguishable groups across forms, contracts and reports.
Preserve the existing categories `coffee`, `groceries`, `eating_out`, `transport`,
`bills`, `subscriptions`, `household`, `health`, `other` and supported clients.
Compatibility projections must not erase the new reporting detail. No routine
purchase reclassifies old entries or edits budget allocations automatically.

An explicitly requested coffee-as-groceries test stays groceries with its factual
description, need/want and override note, and does not create a counted visit.
An emergency source label establishes emergency purpose, not an invented need/want;
retain unknown need/want unless the user/source establishes it.

### Formula and operating dependencies to preserve or replace explicitly

| Handoff reference | Meaning and implementation requirement |
| --- | --- |
| Settings B5 / B6 | Inclusive period end / manually controlled active tracking date |
| Settings B9 / B15 | Emergency target / daily carryover cap; carryover defaults off |
| Dashboard B4 | Last populated ledger running balance; replace row-order dependence with canonical dated cash and explicit cutoff |
| Dashboard B10 | Outstanding bills from Fixed Bills B12, not another outflow |
| Dashboard B11 | `B4 - B6 - B10`: cash after savings protection and unpaid bills |
| Dashboard B12 / B13 | Emergency target / `max(0, endDate - activeDate + 1)` |
| Dashboard B15 | Daily reference; exact formula missing from supplied handoff, use MONEY-08's declared fallback if unavailable |
| Dashboard B16 / B18 | Active-date outflows with J Yes / reference minus that included spend |
| Dashboard B20 / B23 | Counted coffee spend / all outflows with J Yes |
| Coffee G2 / G3 / G5 | Sum of counted visit amounts / visit count / labeled pace forecast |
| Budget Plan C17 / C18 / C19 | Food consumption / counted coffee spend / Other plus Daily usage plus Fun consumption |
| Budget Plan C22 | Paid-status sum, reconciled to linked payments rather than a separate cash owner |
| Budget Plan B23 / B25 | Sum of allocations / protected savings plus unused emergency closing target |
| Daily Tracker D / F | Included day spending / daily reference minus included spending |
| Daily Tracker I / N | CLOSED narrative / recalculating PAST indicator; app must retain actual close evidence |

Fixed Bills' observed B11 and B12 formulas cover different row ranges. EGA totals
must aggregate all matching occurrences, not reproduce that omission. Workbook
coffee and category-coffee totals can differ; expose the reason rather than force
equality. Early coffee/flexible forecasts need coverage warnings. Subscription
ratios must use percentage units, never money formatting. Forecast savings never
prove a transfer. Backdating must recompute cash consistently without relying on
spreadsheet append order.

## 10. Contract review disposition

Independent read-only review covered documentation commit `119e25a` against the
baseline above. This revision resolves opening ownership, durable daily inclusion,
final-day lifecycle, occurrence state/classification, start-of-day inputs,
post-rollover corrections, combined consent, writes-disabled profiles, bounded
authorization and source-reference completeness. These are planning corrections;
they do not establish implementation or runtime acceptance.

The suggested blanket exclusion of reserve-funded emergency spending from daily
totals was not adopted: the handoff explicitly assigns emergency purchases J Yes.
MONEY-08 instead separates current safe cash from the daily comparison and gives
an explicit example, preserving that source rule without a second cash deduction.
