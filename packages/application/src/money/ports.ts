import type {
  MoneyBudgetPlan,
  MoneyBudgetPlanValues,
  MoneyCoffeeVisitRecord,
  MoneyCoffeeVisitValues,
} from "@ega/domain/money";

import type { AuthenticatedActor } from "../auth/actor";
import type { RepositoryResult } from "../shared/result";

/**
 * Persistence ports for MONEY-05 budget plans and counted coffee visits.
 *
 * Every method takes the verified actor; implementations must filter by
 * `owner_user_id` in addition to request-scoped RLS. A coffee visit only
 * references canonical `personal_expenses` rows and never stores a duplicate
 * cash amount.
 */

export type MoneyBudgetPeriod = Readonly<{
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
