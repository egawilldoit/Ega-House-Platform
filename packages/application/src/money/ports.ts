import type {
  MoneyBudgetPlan,
  MoneyBudgetPlanValues,
  MoneyCoffeeVisitRecord,
  MoneyCoffeeVisitValues,
  MoneyCreateValues,
  MoneyDirection,
  MoneyKind,
  MoneyLedgerRow,
  MoneyOpening,
  MoneyOpeningInput,
  MoneyPeriod,
  MoneyPeriodCreateValues,
  MoneyPeriodInitialization,
  MoneyPeriodProvenance,
  MoneyPeriodSettings,
  MoneyPurpose,
  MoneyUpdateChanges,
} from "@ega/domain/money";

import type { AuthenticatedActor } from "../auth/actor";
import type { RepositoryResult } from "../shared/result";

/**
 * Persistence ports for Money. Every operation takes the verified actor;
 * implementations filter by `owner_user_id` in addition to request-scoped RLS.
 * Expense-only queries stay on the existing `ExpenseRepository`.
 *
 * `MoneyPeriodRepository` owns period/opening state (MONEY-03) and is the only
 * period reader. `MoneyMovementRepository` owns ledger movement rows
 * (MONEY-04) and deliberately does not re-read period state.
 */

export type MoneyPeriodCreateRecordInput = Readonly<{
  values: MoneyPeriodCreateValues;
  provenance: MoneyPeriodProvenance;
  openingCreateFingerprint: string | null;
  createdAt: string;
}>;

export type MoneyPeriodOpeningUpdate = Readonly<{
  values: MoneyOpeningInput;
  provenance: MoneyPeriodProvenance;
  initialization: MoneyPeriodInitialization;
  createFingerprint: string;
}>;

export type MoneyPeriodUpdateRecordInput = Readonly<{
  expectedVersion: number;
  activeDate?: string;
  settings?: MoneyPeriodSettings;
  opening?: MoneyPeriodOpeningUpdate;
  updatedAt: string;
}>;

/** Inclusive booking-date window for recorded-cash aggregation. */
export type MoneyLedgerWindow = Readonly<{
  startDate: string;
  endDateInclusive: string;
}>;

export type MoneyLedgerDirectionTotals = Readonly<{
  inflowsMinor: number;
  outflowsMinor: number;
  recordCount: number;
  truncated: boolean;
}>;

export type MoneyLedgerOverview = Readonly<{
  totalExpenseCount: number;
  assignedToPeriodCount: number;
  inPeriodUnassignedCount: number;
}>;

export type MoneyDayStartBaseline = Readonly<{
  date: string;
  version: number;
  availability: "available" | "unavailable";
  unavailableReason: string | null;
  cashMinor: number | null;
  commitmentsMinor: number | null;
  savingsTargetMinor: number | null;
  savingsFundedMinor: number | null;
  emergencyTargetMinor: number | null;
  emergencyUsedMinor: number | null;
}>;

export type MoneyDailyExpenseTotal = Readonly<{ amountMinor: number; complete: boolean }>;

export type MoneyPeriodRepository = {
  ensureDayStartBaseline?(actor: AuthenticatedActor, periodId: string, date: string): Promise<RepositoryResult<MoneyDayStartBaseline>>;
  rebaseDayStartBaseline?(actor: AuthenticatedActor, periodId: string): Promise<RepositoryResult<MoneyDayStartBaseline>>;
  getDayStartBaseline?(
    actor: AuthenticatedActor,
    periodId: string,
    date: string,
  ): Promise<RepositoryResult<MoneyDayStartBaseline | null>>;
  getDailyIncludedExpenseTotal?(actor: AuthenticatedActor, periodId: string, date: string): Promise<RepositoryResult<MoneyDailyExpenseTotal>>;
  findTracking(
    actor: AuthenticatedActor,
  ): Promise<RepositoryResult<MoneyPeriod | null>>;
  findById(
    actor: AuthenticatedActor,
    id: string,
  ): Promise<RepositoryResult<MoneyPeriod | null>>;
  findByExactRange(
    actor: AuthenticatedActor,
    range: Readonly<{ startDate: string; endDate: string }>,
  ): Promise<RepositoryResult<MoneyPeriod[]>>;
  findOverlapping(
    actor: AuthenticatedActor,
    range: Readonly<{ startDate: string; endDate: string }>,
  ): Promise<RepositoryResult<MoneyPeriod[]>>;
  list(
    actor: AuthenticatedActor,
    limit: number,
  ): Promise<RepositoryResult<MoneyPeriod[]>>;
  create(
    actor: AuthenticatedActor,
    input: MoneyPeriodCreateRecordInput,
  ): Promise<RepositoryResult<MoneyPeriod>>;
  update(
    actor: AuthenticatedActor,
    id: string,
    input: MoneyPeriodUpdateRecordInput,
  ): Promise<RepositoryResult<MoneyPeriod>>;
  getOpening(
    actor: AuthenticatedActor,
    id: string,
  ): Promise<RepositoryResult<MoneyOpening | null>>;
  sumLedgerByDirection(
    actor: AuthenticatedActor,
    window: MoneyLedgerWindow,
  ): Promise<RepositoryResult<MoneyLedgerDirectionTotals>>;
  ledgerOverview(
    actor: AuthenticatedActor,
    range: Readonly<{
      /** null when no period is configured; only the total count is known. */
      periodId: string | null;
      startDate: string;
      endDate: string;
    }>,
  ): Promise<RepositoryResult<MoneyLedgerOverview>>;
};

export type MoneyIdempotencyReceipt = Readonly<{
  movement: MoneyLedgerRow;
  createFingerprint: string;
}>;

export type MoneyCreateRecordInput = Readonly<{
  values: MoneyCreateValues;
  createFingerprint: string;
  periodId: string | null;
}>;

export type MoneyListRecordQuery = Readonly<{
  limit: number;
  offset: number;
  from: string | null;
  to: string | null;
  cutoff: string | null;
  kind: MoneyKind | null;
}>;

export type MoneyUpdateRecordInput = Readonly<{
  changes: MoneyUpdateChanges;
  expectedVersion: number;
  updatedAt: string;
}>;

/** Compact row projection used for the application-owned movement totals. */
export type MoneyAggregateRow = Readonly<{
  id: string;
  kind: MoneyKind;
  direction: MoneyDirection;
  amountMinor: number;
  countsInDaily: boolean;
  purpose: MoneyPurpose | null;
  bookingDate: string;
}>;

export type MoneyAggregateQuery = Readonly<{
  cutoff: string;
  /** Inclusive period start; null when no period context is available. */
  startDate: string | null;
}>;

export type MoneyAggregate = Readonly<{
  rows: MoneyAggregateRow[];
  truncated: boolean;
}>;

export type MoneyMovementRepository = {
  findByIdempotencyKey(
    actor: AuthenticatedActor,
    idempotencyKey: string,
  ): Promise<RepositoryResult<MoneyIdempotencyReceipt | null>>;
  create(
    actor: AuthenticatedActor,
    input: MoneyCreateRecordInput,
  ): Promise<RepositoryResult<MoneyLedgerRow>>;
  get(
    actor: AuthenticatedActor,
    id: string,
  ): Promise<RepositoryResult<MoneyLedgerRow | null>>;
  list(
    actor: AuthenticatedActor,
    query: MoneyListRecordQuery,
  ): Promise<RepositoryResult<MoneyLedgerRow[]>>;
  update(
    actor: AuthenticatedActor,
    id: string,
    input: MoneyUpdateRecordInput,
  ): Promise<RepositoryResult<MoneyLedgerRow>>;
  aggregate(
    actor: AuthenticatedActor,
    query: MoneyAggregateQuery,
  ): Promise<RepositoryResult<MoneyAggregate>>;
};

/* ------------------------------------------------------------------ */
/* MONEY-05 ports: period budget plan and counted coffee visits        */
/* ------------------------------------------------------------------ */

/**
 * Persistence ports for MONEY-05. Every method takes the verified actor;
 * implementations filter by `owner_user_id` in addition to request-scoped RLS.
 * A budget plan references one canonical `money_periods` row; a coffee visit
 * references canonical `personal_expenses` rows and never stores a duplicate
 * cash amount.
 */

export type MoneyBudgetPeriod = Readonly<{
  periodId: string;
  periodStartDate: string;
  periodEndDate: string;
}>;

export type MoneyBudgetPlanCreateInput = Readonly<{
  values: MoneyBudgetPlanValues;
  createdAt: string;
}>;

export type MoneyBudgetPlanUpdateInput = Readonly<{
  values: MoneyBudgetPlanValues;
  expectedVersion: number;
  updatedAt: string;
}>;

export type MoneyBudgetRepository = {
  getPlan(
    actor: AuthenticatedActor,
    period: MoneyBudgetPeriod,
  ): Promise<RepositoryResult<MoneyBudgetPlan | null>>;
  createPlan(
    actor: AuthenticatedActor,
    input: MoneyBudgetPlanCreateInput,
  ): Promise<RepositoryResult<MoneyBudgetPlan>>;
  updatePlan(
    actor: AuthenticatedActor,
    id: string,
    input: MoneyBudgetPlanUpdateInput,
  ): Promise<RepositoryResult<MoneyBudgetPlan>>;
};

export type MoneyCoffeeVisitCreateInput = Readonly<{
  values: MoneyCoffeeVisitValues;
  visitFingerprint: string;
  createdAt: string;
}>;

export type MoneyCoffeeVisitListQuery = Readonly<{
  from: string;
  to: string;
  limit: number;
  offset: number;
}>;

export type MoneyCoffeeVisitRepository = {
  findByVisitKey(
    actor: AuthenticatedActor,
    visitKey: string,
  ): Promise<RepositoryResult<MoneyCoffeeVisitRecord | null>>;
  createVisit(
    actor: AuthenticatedActor,
    input: MoneyCoffeeVisitCreateInput,
  ): Promise<RepositoryResult<MoneyCoffeeVisitRecord>>;
  getVisit(
    actor: AuthenticatedActor,
    id: string,
  ): Promise<RepositoryResult<MoneyCoffeeVisitRecord | null>>;
  listVisits(
    actor: AuthenticatedActor,
    query: MoneyCoffeeVisitListQuery,
  ): Promise<RepositoryResult<MoneyCoffeeVisitRecord[]>>;
  deleteVisit(
    actor: AuthenticatedActor,
    id: string,
    expectedVersion: number,
    deletedAt: string,
  ): Promise<RepositoryResult<Readonly<{ id: string; alreadyDeleted: boolean }>>>;
  listVisitIdsForExpense(
    actor: AuthenticatedActor,
    expenseId: string,
  ): Promise<RepositoryResult<string[]>>;
};
