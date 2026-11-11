# Money shared implementation contract (MONEY-01 → MONEY-14)

Status: coordinator-owned contract for parallel MONEY-02…MONEY-06 work.
Base commit: `005d3573` (MONEY-01 branch). This document is the only shared
architecture decision for the parallel round; issue acceptance criteria remain
in [`money-mcp-full-delivery.md`](money-mcp-full-delivery.md).

## One ledger, one owner per rule

The canonical money store is the existing `public.personal_expenses` table,
extended additively. No second expense/ledger table, no per-issue movement
store, no duplicate balance calculation.

| Concern | Canonical owner |
| --- | --- |
| Movement kinds, direction, daily flag, category/need/purpose parsing | `packages/domain/src/money.ts` (new) + existing `packages/domain/src/expenses.ts` |
| Expense + movement use cases, summaries, calculations | `packages/application/src/money/*` (new) and existing `packages/application/src/expenses/*` |
| Persistence, owner filters, RLS-facing queries | `packages/data-access/src/money/repository.ts` (new) and existing expenses repository |
| Wire DTOs | `packages/contracts/src/money.ts` (new), reusing `expenses.ts` shapes where compatible |
| Typed HTTP client | `packages/api-client/src/money.ts` (new) |
| Hono routes | `apps/server/src/routes/money.ts` (new) beside `expenses.ts` |
| Web Money UI | `apps/web/src/app/(workspace)/money/**` |
| MCP money tools | `apps/web/src/lib/mcp/money/**` (new) and the existing registration/handler files |
| Analytics read model (MONEY-08/11) | `packages/application/src/money/analytics.ts` |

## Shared domain types (freeze these names)

```ts
export const MONEY_KINDS = [
  "expense",
  "income",
  "opening",
  "savings_transfer",
  "reconciliation_adjustment",
] as const;
export type MoneyKind = (typeof MONEY_KINDS)[number];

export const MONEY_DIRECTIONS = ["in", "out"] as const;
export type MoneyDirection = (typeof MONEY_DIRECTIONS)[number];

export const MONEY_PURPOSES = ["fixed", "flexible", "emergency"] as const;
export type MoneyPurpose = (typeof MONEY_PURPOSES)[number];

export type MoneyLedgerRow = {
  id: string;
  kind: MoneyKind;
  direction: MoneyDirection;           // "in" for income/opening/savings-in
  amountMinor: number;                 // always positive integer centimes
  currency: "MAD";
  category: ExpenseCategory | null;    // null for non-expense kinds
  note: string | null;
  merchant: string | null;
  needVsWant: ExpenseNeedVsWant | null;
  paymentMethod: ExpensePaymentMethod | null;
  purpose: MoneyPurpose | null;
  countsInDaily: boolean;
  bookingDate: string;                 // YYYY-MM-DD, owner-local booking day
  occurredAt: string | null;           // real instant only when known
  periodId: string | null;
  version: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
```

Rules:
- `amountMinor` is always positive; direction and kind carry the sign. Do not
  encode income as a negative expense.
- `countsInDaily` defaults: expense/emergency true; opening, income, savings
  transfer, reconciliation adjustment false. Explicit overrides persist.
- Non-expense rows have `category`/`needVsWant` null; never fabricate them.
- `bookingDate` is required for new writes; `occurredAt` may be null for a
  date-only booking (MONEY-04), but legacy rows keep their timestamp.
- Cash at cutoff = opening + inflows − outflows (opening excluded from the
  in/out terms).

## Period contract (MONEY-03)

New table `public.money_periods` owned by MONEY-03:
`id, owner_user_id, start_date, end_date, currency, timezone, active_date,
lifecycle ('tracking'|'ended'|'rolled_over'), initialization
('uninitialized'|'initialized'|'reconciled'), opening_movement_id,
provenance jsonb, settings jsonb, version, created_at, updated_at`.

- One `opening` ledger row per owner/period, referenced by
  `opening_movement_id`; never store a second editable opening amount.
- `lifecycle='tracking'` is the only period accepting routine writes.
- Historical period settings live in `settings`/policy versions; today's
  targets never rewrite history.

## Migration allocation (coordinator-owned; do not renumber)

| Issue | Journal tag | `when` |
| --- | --- | --- |
| MONEY-01 | `0093_money_01_finance_grants` | 1787880000056 |
| MONEY-02 | `0094_money_02_expense_management` | 1787880000057 |
| MONEY-03 | `0095_money_03_periods` | 1787880000058 |
| MONEY-04 | `0096_money_04_movements` | 1787880000059 |
| MONEY-05 | `0097_money_05_budgets_coffee` | 1787880000060 |
| MONEY-06 | `0098_money_06_obligations` | 1787880000061 |

Workers add only their reserved file + journal entry; the coordinator resolves
conflicts and applies migrations serially. Never edit an applied migration.
Every new statement needs `--> statement-breakpoint` (the CI DB proofs split on
it). Every DB proof script must seed `auth.users` with
`ab.mortaki@gmail.com` for the 0043 reconciliation migration.

## Service surface (minimum names)

- `packages/application/src/money/service.ts`: movement CRUD with optimistic
  version, stable `idempotencyKey` + full semantic fingerprint, owner scope.
- `packages/application/src/money/periods.ts`: initialize/read/update period
  and active date (MONEY-03).
- `packages/application/src/money/summary.ts`: recorded cash, expense totals,
  daily included spending, category totals (MONEY-04+).
- `packages/application/src/money/analytics.ts`: reserves/reference/forecast
  (MONEY-08/11).

All use `AuthenticatedActor`; no caller-supplied owner id. Repository methods
filter `owner_user_id` in addition to RLS.

## MCP surface (minimum names)

Money tools live in `apps/web/src/lib/mcp/money/` and are registered through
the existing permission/tool-discovery/write-receipt machinery:

- reads: `ega_money_state`, `ega_money_ledger_list`, `ega_money_get` (02)
- writes: `ega_money_create_expense`, `ega_money_update_expense`,
  `ega_money_delete_expense` (02), `ega_money_update_settings` (03),
  `ega_money_create_movement` (04), `ega_money_set_allocation` (05)

Every mutation uses `withExclusiveMutation` semantics: stable operationId,
full normalized semantic input in the outer receipt, expected version where
required, and permission checks from the stored grant. Never a stub, SQL proxy
or independent calculator.

## Parallel ownership boundaries

- MONEY-02: expense CRUD/read/export/refresh; `0094`; no period tables.
- MONEY-03: period/opening/active date; `0095`; depends on 02's ledger read.
- MONEY-04: income/savings/movements + cash math; `0096`; extends 03.
- MONEY-05: allocations/categories/coffee visits; `0097`; extends 04.
- MONEY-06: obligations/templates/lifecycle; `0098`; extends 03+05.

Workers may implement against this contract before predecessors merge. Do not
invent a second contract, table or calculation. Report dependency assumptions
and integration requirements with the commit.
