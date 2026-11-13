import {
  moneyDayCloseChangedFields,
  type MoneyDayClose,
  type MoneyDayCloseComparison,
  type MoneyDayCloseRestatedTotals,
  type MoneyOpening,
  type MoneyPeriod,
} from "@ega/domain/money";

import type { AuthenticatedActor } from "../auth/actor";
import {
  applicationFailure,
  applicationSuccess,
  type ApplicationResult,
} from "../shared/result";
import type { MoneyPeriodRepository } from "./ports";
import { getMoneyCashPosition } from "./summary";

/**
 * MONEY-09 close read model.
 *
 * The retained close snapshot is immutable. This read recomputes the live
 * totals for the closed date and compares them with that evidence, so a later
 * correction shows explicitly restated values instead of silently rewriting
 * the original close. Incomplete live data stays unavailable; it is never
 * reported as unchanged.
 */

export type MoneyDayCloseView = Readonly<{
  close: MoneyDayClose;
  comparison: MoneyDayCloseComparison;
}>;

export type MoneyDayCloseReadDependencies = Readonly<{
  periods: Pick<MoneyPeriodRepository, "sumLedgerByDirection"> &
    Partial<Pick<MoneyPeriodRepository, "getDayCloseCurrentTotals">>;
}>;

export async function getMoneyDayCloseView(
  actor: AuthenticatedActor,
  dependencies: MoneyDayCloseReadDependencies,
  period: MoneyPeriod,
  opening: Pick<MoneyOpening, "amountMinor"> | null,
  close: MoneyDayClose,
): Promise<ApplicationResult<MoneyDayCloseView>> {
  if (!dependencies.periods.getDayCloseCurrentTotals) {
    return applicationSuccess({
      close,
      comparison: { available: false, reason: "restated_totals_unavailable" },
    });
  }
  const getDayCloseCurrentTotals =
    dependencies.periods.getDayCloseCurrentTotals.bind(dependencies.periods);

  const [totals, cash] = await Promise.all([
    getDayCloseCurrentTotals(
      actor,
      period.id,
      close.closeDate,
    ),
    getMoneyCashPosition(
      actor,
      dependencies.periods,
      period,
      opening,
      close.closeDate,
    ),
  ]);

  if (!totals.ok || !cash.ok) {
    return applicationSuccess({
      close,
      comparison: { available: false, reason: "restated_totals_unavailable" },
    });
  }
  if (!totals.value.complete || !cash.data.available) {
    return applicationSuccess({
      close,
      comparison: {
        available: false,
        reason: !totals.value.complete
          ? "restated_totals_incomplete"
          : "recorded_cash_unavailable",
      },
    });
  }

  const restated: MoneyDayCloseRestatedTotals = {
    ...totals.value,
    recordedCashMinor: cash.data.recordedCashMinor,
  };
  const changedFields = moneyDayCloseChangedFields(close.snapshot, restated);
  return applicationSuccess({
    close,
    comparison: {
      available: true,
      changed: changedFields.length > 0,
      changedFields,
      restated,
    },
  });
}

/** Load the close evidence for a resolved date plus the latest retained close. */
export async function loadMoneyDayCloseViews(
  actor: AuthenticatedActor,
  repository: MoneyPeriodRepository,
  period: MoneyPeriod,
  opening: Pick<MoneyOpening, "amountMinor"> | null,
  resolvedDate: string,
): Promise<
  ApplicationResult<
    Readonly<{
      dayClose: MoneyDayCloseView | null;
      lastClose: MoneyDayCloseView | null;
      recentCloses: readonly MoneyDayClose[];
    }>
  >
> {
  if (!repository.listDayCloses) {
    return applicationSuccess({
      dayClose: null,
      lastClose: null,
      recentCloses: [],
    });
  }
  const result = await repository.listDayCloses(actor, period.id, 12);
  if (!result.ok) {
    return applicationFailure(
      "Unable to load retained day closes right now.",
      result.error.code,
    );
  }
  const closes = result.value;
  const forDate = closes.find((close) => close.closeDate === resolvedDate) ?? null;
  const latest = closes[0] ?? null;

  if (forDate && latest && forDate.id === latest.id) {
    const view = await getMoneyDayCloseView(actor, { periods: repository }, period, opening, forDate);
    if (!view.ok) return view;
    return applicationSuccess({
      dayClose: view.data,
      lastClose: view.data,
      recentCloses: closes,
    });
  }

  const [dayClose, lastClose] = await Promise.all([
    forDate ? getMoneyDayCloseView(actor, { periods: repository }, period, opening, forDate) : null,
    latest ? getMoneyDayCloseView(actor, { periods: repository }, period, opening, latest) : null,
  ]);
  if (dayClose && !dayClose.ok) return dayClose;
  if (lastClose && !lastClose.ok) return lastClose;

  return applicationSuccess({
    dayClose: dayClose?.data ?? null,
    lastClose: lastClose?.data ?? null,
    recentCloses: closes,
  });
}
