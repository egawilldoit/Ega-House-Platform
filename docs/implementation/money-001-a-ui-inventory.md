# MONEY-001-A Money UI keep / consolidate / remove inventory

Status: implementation inventory for issue #432 (MONEY-001-A), reviewed before
the primary `/money` replacement. Baseline: `4a27dd6460a24ccf6528cbb418138dbe26362100`.
This is a presentation/navigation inventory, not a data deletion plan. No stored
Money record, audit row, export path, obligation, target or setting is removed.

## Before: primary `/money` surface

The page mounted fourteen sections plus two navigation links, two independent
tables and two independent creation forms. Counts below are the actual
server-rendered panels/forms at the baseline.

| # | Panel / form | Callers | Data dependency | Persistence | Decision | Reason |
|---|---|---|---|---|---|---|
| 1 | Money ledger / Recurring nav | `page.tsx` | none | none | **Consolidate** | Two links become one primary/secondary navigation with anchors. |
| 2 | `MoneyReservesPanel` | `page.tsx` | `getCurrentMoneyReserves` → period + budget repositories | period policy/settings | **Consolidate** | Recorded cash, safe flexible and protections move to one compact primary summary; the full nine-field detail stays in the secondary savings section. |
| 3 | `MoneyDailyReferencePanel` | `page.tsx` | `MoneyState.dayStartBaseline.dailyReference` | `money_day_start_baselines` | **Consolidate** | Day-start reference and live remaining are primary figures, not a separate competing panel. |
| 4 | `MoneyPeriodPanel` | `page.tsx` | `getMoneyState`, `createMoneyPeriodAction`, `updateMoneySettingsAction`, `rebaseMoneyDayStartBaselineAction` | `money_periods`, opening row, baselines, policy versions | **Keep (secondary)** | Period setup, active date, opening correction and explicit baseline setup remain reachable. |
| 5 | `MoneyRolloverVariancePanel` | `page.tsx` | `listMoneyRolloverBridges` | `money_period_rollover_bridges` | **Keep (secondary)** | Historical correction variances stay visible beside rollover/audit. |
| 6 | `MoneyDayClosePanel` | `page.tsx` | `getMoneyState` closes, `closeMoneyDayAction` | `money_day_closes`, `personal_expenses`, baselines | **Keep (secondary)** | Optional explicit attestation; now shows skipped/unverified days and never blocks later booking. |
| 7 | `MoneyRolloverPanel` | `page.tsx` | `getMoneyRolloverPreviewForPeriod`, `rolloverMoneyPeriodAction` | `money_period_rollovers`, successors, occurrences | **Keep (secondary), extend** | Available for a tracking source after review (new acknowledgment note) as well as an ended source. |
| 8 | `MoneyRecordedSpendingPanel` | `page.tsx` | `getExpenseSummary` | `personal_expenses` projection | **Remove from primary** | Redundant day/week/month/coffee aggregate; the unified history plus daily reference already communicate spending. `getExpenseSummary` remains only for cap progress. |
| 9 | `MoneyBudgetPlanPanel` | `page.tsx` | `getMoneyBudgetPlan`, `getMoneyPeriodSpending`, `getMoneyCoffeeVisitUsage`, `saveBudgetPlanAction` | budget plan/allocations | **Keep (secondary)** | Planning values remain reachable; not needed for an ordinary purchase. |
| 10 | `MoneyCapsPanel` + `CategoryCapsForm` | `page.tsx` | `getExpenseSummary`, preferences | `user_preferences.categoryCaps` | **Keep (secondary)** | Genuinely used advisory caps remain editable; not a top-level dashboard. |
| 11 | `MoneyExportPanel` | `page.tsx` | `/money/export` route | export projection | **Keep (secondary)** | Working complete-or-refused CSV export remains one click away. |
| 12 | `MoneyCreatePanel` + `ExpenseCreateForm` | `page.tsx`, `components/money/index.ts` | `createExpenseAction` | `personal_expenses` | **Remove (superseded)** | One parallel Money-page creation form. The unified quick entry posts all kinds through `createMovementAction`. `QuickExpenseSheet` on Today is a different surface and stays. |
| 13 | `MoneyMovementPanel` | `page.tsx` | `createMovementAction` | `personal_expenses` | **Replace** | Becomes the single `MoneyQuickEntry` with expense-first defaults, one durable write and the same stable idempotency receipt. |
| 14 | Expenses table | `page.tsx` | `listExpenses` + `MoneyRowActions` | `personal_expenses` | **Consolidate** | Folded into the unified history with the same expense edit/soft-delete controls. |
| 15 | Movement ledger table | `page.tsx` | `listMovements({ excludeKind: "expense" })` + `MoneyMovementActions` | `personal_expenses` | **Consolidate** | Folded into the same history so every kind appears in one chronological, independently paginated list. |

Baseline primary counts: **14 sections**, **10 form actions** (create expense,
record movement, save period, save settings, rebase, close day, roll over, save
budget, save caps, export), **2 parallel creation forms**, **2 independent
paginated tables**, and **3 independent totals/read paths** for the same ledger.

## After: target primary surface

Primary hierarchy, in order:

1. **One financial summary**: recorded spendable cash with cutoff/basis,
   safe-to-spend after protections, day-start daily reference and live remaining,
   plus an explicit unverified-days line.
2. **One quick entry**: expense, income, savings transfer or reconciliation
   adjustment through `createMovementAction`; expense is the default kind.
3. **One unified history**: `listMovements` with no kind exclusion, one URL
   offset, optional kind filter, selected-period continuity, expense edit/delete
   and non-expense versioned correction. Empty, failed and truncated states are
   explicit.
4. **Secondary navigation**: Bills & recurring (`/money/recurring`), Savings &
   emergency detail, Budget & caps, Export, Period setup, Day close, and
   Finalize / roll over + variance history. Each target remains a real section
   or existing route.

Target counts: **1 primary summary + 1 quick entry + 1 history**, **1 primary
creation form**, **1 paginated table**, **7 secondary capability groups**, and
**5 secondary form actions** (period create/settings/rebase, budget, caps) plus
the existing day-close, rollover and export controls.

## Routes and compatibility surfaces

| Surface | Decision | Reason |
|---|---|---|
| `/money` | **Replace** | Primary consolidation described above. |
| `/money/recurring` + `ObligationsView` | **Keep** | Bills/subscriptions and payment lifecycle have a dedicated route and canonical payment use cases. |
| `/money/export` | **Keep** | Complete-or-refused CSV export; no data change. |
| `createExpenseAction` / `ExpenseEditForm` / `DeleteExpenseControl` / `QuickExpenseSheet` | **Keep** | Today quick expense and expense correction are still used; the Money history reuses the expense editor without a second DTO. |
| `listExpenses` application use case | **Keep** | Other surfaces/tests still call it; the Money page simply stops using it for its primary history. |
| MCP/HTTP Money reads and writes | **Keep** | Same application use cases; only additive fields are added for finalization acknowledgment. |

## Removal rule applied

A panel/component is removed only after the replacement renders and its
remaining callers are checked with a repository search. Canonical finance rules,
audit/close/rollover evidence, exports, obligations, targets/settings and all
persisted Money rows remain owned by the existing domain/application/data-access
layers.
