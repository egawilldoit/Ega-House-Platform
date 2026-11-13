import {
  moneyDayCloseTransition,
  parseMoneyDayCloseInput,
  type MoneyDayClose,
  type MoneyDayCloseValues,
  type MoneyLedgerRow,
  type MoneyPeriod,
} from "@ega/domain/money";

import type { AuthenticatedActor } from "../auth/actor";
import { sha256Hex } from "../shared/hash";
import type { ApplicationErrorCode } from "../shared/result";
import type { MoneyMovementRepository, MoneyPeriodRepository } from "./ports";
import { createMovement } from "./service";

/**
 * MONEY-09 day-close use case.
 *
 * A close is durable evidence, not a projection: one database transaction
 * stores the CLOSED note, the calculated day totals, the retained day-start
 * baseline, the reserve/reference snapshot and the close identity, then
 * advances the active date exactly once. Final purchases are recorded first
 * through the canonical movement use case with stable identities, so a failed
 * purchase prevents the transition while already committed purchases stay
 * explicitly recoverable.
 */

export type CloseMoneyDayDependencies = Readonly<{
  periods: Pick<
    MoneyPeriodRepository,
    "findTracking" | "findById" | "list" | "closeDay"
  > &
    Partial<
      Pick<
        MoneyPeriodRepository,
        "getDayCloseByOperation" | "listDayCloses" | "getDayStartBaseline"
      >
    >;
  movements: MoneyMovementRepository;
}>;

export type CloseMoneyDayOutcome = Readonly<{
  close: MoneyDayClose;
  period: MoneyPeriod;
  replayed: boolean;
  committedPurchases: readonly MoneyLedgerRow[];
}>;

export type CloseMoneyDayResult =
  | { ok: true; data: CloseMoneyDayOutcome }
  | {
      ok: false;
      errorMessage: string;
      code?: ApplicationErrorCode;
      reason?: string;
      /** Purchases already committed before a later item failed. */
      committedPurchases?: readonly MoneyLedgerRow[];
      failedPurchaseIndex?: number;
    };

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * Semantic close identity. It deliberately excludes the operation id so an
 * ambiguous retry that arrives with a fresh transport operation still resolves
 * to the retained close instead of fabricating a second one.
 */
export function moneyDayCloseFingerprint(
  values: MoneyDayCloseValues,
  resolved: Readonly<{ periodId: string; date: string }>,
): string {
  return sha256Hex(
    canonicalJson({
      periodId: resolved.periodId,
      date: resolved.date,
      expectedVersion: values.expectedVersion,
      note: values.note,
      finalPurchases: values.finalPurchases
        .map((purchase) => ({
          amountMinor: purchase.amountMinor,
          category: purchase.category,
          note: purchase.note,
          merchant: purchase.merchant,
          needVsWant: purchase.needVsWant,
          paymentMethod: purchase.paymentMethod,
          purpose: purchase.purpose,
          countsInDaily: purchase.countsInDaily ?? true,
          idempotencyKey: purchase.idempotencyKey,
        }))
        .sort((left, right) =>
          left.idempotencyKey.localeCompare(right.idempotencyKey),
        ),
    }),
  );
}

function failureForStatus(
  status:
    | "not_found"
    | "stale_version"
    | "period_not_tracking"
    | "date_out_of_period"
    | "close_date_not_active"
    | "operation_conflict"
    | "duplicate_close"
    | "baseline_unavailable"
    | "opening_unknown"
    | "included_movement_invalid",
  detail: string | null,
  period: MoneyPeriod | null,
): Omit<Extract<CloseMoneyDayResult, { ok: false }>, "ok"> {
  switch (status) {
    case "not_found":
      return {
        errorMessage:
          "No Money period is configured for this close. Create a tracking period first.",
        code: "notFound",
        reason: "period_not_found",
      };
    case "stale_version":
      return {
        errorMessage: "The period changed. Reload it and close the active day again.",
        code: "conflict",
        reason: "stale_period",
      };
    case "period_not_tracking":
      return {
        errorMessage:
          "This period is ended or rolled over. A routine close requires a tracking period; historical corrections use the versioned correction path.",
        code: "validation",
        reason: "period_not_tracking",
      };
    case "date_out_of_period":
      return {
        errorMessage: `The close date must fall between ${period?.startDate ?? "the period start"} and ${period?.endDate ?? "the period end"}.`,
        code: "validation",
        reason: "date_out_of_period",
      };
    case "close_date_not_active":
      return {
        errorMessage: period
          ? `Only the active date ${period.activeDate} can be closed. ${detail ?? "The requested date"} is not active; a lagging or earlier day cannot be skipped, and a past day is corrected through the versioned movement path.`
          : "Only the current active date can be closed.",
        code: "validation",
        reason: "close_date_not_active",
      };
    case "operation_conflict":
      return {
        errorMessage:
          "That operation id was already used for a different day close. Use the original request or a new operation id.",
        code: "conflict",
        reason: "operation_conflict",
      };
    case "duplicate_close":
      return {
        errorMessage:
          "This day already has a retained close with different evidence. Reload and inspect the original close instead of closing it again.",
        code: "conflict",
        reason: "duplicate_close",
      };
    case "baseline_unavailable":
      return {
        errorMessage: `Close needs complete day-start inputs. Complete or explicitly rebase the day-start baseline first (${detail ?? "baseline unavailable"}).`,
        code: "validation",
        reason: "baseline_unavailable",
      };
    case "opening_unknown":
      return {
        errorMessage:
          "Close needs known opening cash for this period. Initialize or correct the single opening movement first.",
        code: "validation",
        reason: "opening_unknown",
      };
    case "included_movement_invalid":
      return {
        errorMessage:
          "One or more final purchases are not recorded on this date in this period. Retry their stable identities so every purchase is recorded before closing.",
        code: "validation",
        reason: "included_movement_invalid",
      };
  }
}

export async function closeMoneyDay(
  actor: AuthenticatedActor,
  dependencies: CloseMoneyDayDependencies,
  input: unknown,
): Promise<CloseMoneyDayResult> {
  const parsed = parseMoneyDayCloseInput(input);
  if (!parsed.ok) {
    return {
      ok: false,
      errorMessage: parsed.message,
      code: "validation",
      reason: "invalid_close_request",
    };
  }
  const values = parsed.value;

  if (!dependencies.periods.closeDay) {
    return {
      ok: false,
      errorMessage: "Closing a Money day is unavailable right now.",
      code: "unknown",
    };
  }
  const closeDay = dependencies.periods.closeDay.bind(dependencies.periods);

  // A repeated operation resolves before period/date validation: after a
  // successful close the active date has advanced, so the original expected
  // version and date are intentionally stale.
  if (dependencies.periods.getDayCloseByOperation) {
    const existing = await dependencies.periods.getDayCloseByOperation(
      actor,
      values.operationId,
    );
    if (!existing.ok) {
      return {
        ok: false,
        errorMessage: "Unable to check the existing day close right now.",
        code: "unknown",
      };
    }
    if (existing.value) {
      const retained = existing.value;
      const replayFingerprint = moneyDayCloseFingerprint(values, {
        periodId: values.periodId ?? retained.periodId,
        date: values.date ?? retained.closeDate,
      });
      if (replayFingerprint !== retained.closeFingerprint) {
        return {
          ok: false,
          ...failureForStatus("operation_conflict", null, null),
        };
      }
      const period = await dependencies.periods.findById(actor, retained.periodId);
      if (!period.ok) {
        return {
          ok: false,
          errorMessage: "Unable to load the period for this close right now.",
          code: "unknown",
        };
      }
      if (!period.value) {
        return {
          ok: false,
          ...failureForStatus("not_found", null, null),
        };
      }
      return {
        ok: true,
        data: {
          close: retained,
          period: period.value,
          replayed: true,
          committedPurchases: [],
        },
      };
    }
  }

  let period: MoneyPeriod | null;
  if (values.periodId) {
    const found = await dependencies.periods.findById(actor, values.periodId);
    if (!found.ok) {
      return {
        ok: false,
        errorMessage: "Unable to load the Money period right now.",
        code: "unknown",
      };
    }
    period = found.value;
    if (!period) {
      return { ok: false, ...failureForStatus("not_found", null, null) };
    }
  } else {
    const tracking = await dependencies.periods.findTracking(actor);
    if (!tracking.ok) {
      return {
        ok: false,
        errorMessage: "Unable to load the tracking Money period right now.",
        code: "unknown",
      };
    }
    period = tracking.value;
    if (!period) {
      return { ok: false, ...failureForStatus("not_found", null, null) };
    }
  }

  const date = values.date ?? period.activeDate;
  const transition = moneyDayCloseTransition(period, {
    date,
    expectedVersion: values.expectedVersion,
  });
  if (!transition.ok) {
    if (transition.reason === "date_not_active") {
      return {
        ok: false,
        ...failureForStatus("close_date_not_active", date, period),
      };
    }
    if (transition.reason === "date_after_active") {
      return {
        ok: false,
        errorMessage: `Close cannot skip an unclosed active day. The active date is ${period.activeDate}; close that date first.`,
        code: "validation",
        reason: "close_date_not_active",
      };
    }
    if (transition.reason === "invalid_period") {
      return {
        ok: false,
        ...failureForStatus("date_out_of_period", date, period),
      };
    }
    if (transition.reason === "period_not_tracking") {
      return { ok: false, ...failureForStatus("period_not_tracking", null, period) };
    }
    return { ok: false, ...failureForStatus("stale_version", null, period) };
  }

  // Validate complete inputs before recording final purchases. The transaction
  // re-checks these conditions; this pre-check avoids committing purchases for
  // a close that is already impossible.
  if (!period.openingMovementId) {
    return { ok: false, ...failureForStatus("opening_unknown", null, period) };
  }
  if (dependencies.periods.getDayStartBaseline) {
    const baseline = await dependencies.periods.getDayStartBaseline(
      actor,
      period.id,
      date,
    );
    if (!baseline.ok) {
      return {
        ok: false,
        errorMessage: "Unable to validate the day-start baseline right now.",
        code: "unknown",
        reason: "baseline_read_failed",
      };
    }
    if (!baseline.value || baseline.value.availability !== "available") {
      return {
        ok: false,
        ...failureForStatus(
          "baseline_unavailable",
          baseline.value?.unavailableReason ?? "baseline_missing",
          period,
        ),
      };
    }
  }

  // Record every final purchase first through the canonical create path. A
  // failed item returns the committed rows so a retry can reconcile instead of
  // closing over an unrecorded purchase.
  const committedPurchases: MoneyLedgerRow[] = [];
  for (const [index, purchase] of values.finalPurchases.entries()) {
    const created = await createMovement(
      actor,
      dependencies.movements,
      {
        kind: "expense",
        amountMinor: purchase.amountMinor,
        category: purchase.category,
        note: purchase.note,
        merchant: purchase.merchant,
        needVsWant: purchase.needVsWant,
        paymentMethod: purchase.paymentMethod,
        purpose: purchase.purpose,
        ...(purchase.countsInDaily === null
          ? {}
          : { countsInDaily: purchase.countsInDaily }),
        bookingDate: date,
        occurredAt: null,
        idempotencyKey: purchase.idempotencyKey,
      },
      {
        periods: dependencies.periods as Pick<
          MoneyPeriodRepository,
          "findTracking" | "list"
        >,
      },
    );
    if (!created.ok) {
      return {
        ok: false,
        errorMessage: `Final purchase ${index + 1} was not recorded: ${created.errorMessage} The day was not closed.${committedPurchases.length > 0 ? ` ${committedPurchases.length} earlier final purchase(s) are already recorded and remain recoverable with their stable identities.` : ""}`,
        code: created.code,
        reason: "final_purchase_failed",
        committedPurchases,
        failedPurchaseIndex: index,
      };
    }
    committedPurchases.push(created.data.movement);
  }

  const closeFingerprint = moneyDayCloseFingerprint(values, {
    periodId: period.id,
    date,
  });

  const attempt = await closeDay(actor, {
    periodId: period.id,
    expectedVersion: values.expectedVersion,
    date,
    note: values.note,
    operationId: values.operationId,
    closeFingerprint,
    includedMovementIds: committedPurchases.map((movement) => movement.id),
    createdAt: new Date().toISOString(),
  });
  if (!attempt.ok) {
    return {
      ok: false,
      errorMessage:
        attempt.error.code === "forbidden"
          ? "You do not have permission to close this Money day."
          : "Unable to close the Money day right now. Purchases recorded before the attempt remain in the ledger.",
      code: attempt.error.code,
      reason: "close_write_failed",
      committedPurchases,
    };
  }

  const result = attempt.value;
  if (result.status === "closed" || result.status === "replayed") {
    if (!result.close || !result.period) {
      return {
        ok: false,
        errorMessage: "The day close returned incomplete evidence. Inspect the ledger before retrying.",
        code: "unknown",
        reason: "close_evidence_incomplete",
        committedPurchases,
      };
    }
    return {
      ok: true,
      data: {
        close: result.close,
        period: result.period,
        replayed: result.status === "replayed",
        committedPurchases,
      },
    };
  }

  return {
    ok: false,
    ...failureForStatus(result.status, result.detail, result.period ?? period),
    committedPurchases,
  };
}
