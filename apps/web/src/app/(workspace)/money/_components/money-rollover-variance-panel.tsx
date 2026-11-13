import type { MoneyRolloverBridgeRecord } from "@ega/application";
import { formatMinorToMad } from "@/lib/money/money-amount";

type MoneyRolloverVariancePanelProps = {
  bridges: readonly MoneyRolloverBridgeRecord[] | null;
  unavailableReason: string | null;
};

/**
 * Historical correction disclosure for a period that received a bridge from a
 * rolled-over predecessor. Variance rows mean a later correction was
 * intentionally not posted into an independently verified opening; the opening
 * snapshot itself is never altered.
 */
export function MoneyRolloverVariancePanel({
  bridges,
  unavailableReason,
}: MoneyRolloverVariancePanelProps) {
  const variances = (bridges ?? []).filter((bridge) => !bridge.applied);
  if (unavailableReason === null && variances.length === 0) return null;

  return (
    <section
      aria-labelledby="money-rollover-variance-heading"
      className="mt-6 rounded-lg border border-ega-border p-5"
    >
      <h2
        id="money-rollover-variance-heading"
        className="text-[length:var(--text-section)] font-semibold tracking-[var(--tracking-tight)]"
      >
        Historical correction variance
      </h2>
      {unavailableReason ? (
        <p role="status" className="mt-2 text-[color:var(--ega-text-secondary)]">
          {unavailableReason}
        </p>
      ) : (
        <>
          <p className="mt-2 text-[color:var(--ega-text-secondary)]">
            A correction to the previous period could not be posted into this
            period&apos;s independently verified opening. The variance is disclosed
            here and the verified snapshot stays unchanged.
          </p>
          <ul className="mt-3 flex flex-col gap-1">
            {variances.map((bridge) => (
              <li key={bridge.id}>
                <span className="font-medium">
                  {formatMinorToMad(bridge.amountMinor)}{" "}
                  {bridge.direction === "in" ? "in" : "out"}
                </span>{" "}
                — {bridge.varianceReason?.replaceAll("_", " ")} (movement{" "}
                {bridge.movementId}, version {bridge.correctionVersion})
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
