import styles from "./preferences.module.css";
import { DAYS, DAY_LABELS, type Day, type Schedule } from "./schedule-model";

type TargetKey = "work" | "jobSearch";

export function DailyTargets({
  targets,
  onTargetChange,
}: {
  targets: Schedule["targets"];
  onTargetChange: (day: Day, field: TargetKey, rawValue: string) => void;
}) {
  return (
    <section className={styles.panel} aria-labelledby="daily-targets-title">
      <div className={styles.panelHeader}>
        <div>
          <h2 id="daily-targets-title" className={styles.panelTitle}>
            Daily targets
          </h2>
          <p className={styles.panelDescription}>
            Minutes per day. Totals update from these values before the change is
            saved; the server still validates every entry.
          </p>
        </div>
      </div>

      <div className={styles.panelBody}>
        <div className={styles.targets}>
          {DAYS.map((day) => {
            const target = targets[day];
            const workInvalid = target.work < 0 || target.work > 1440;
            const searchInvalid = target.jobSearch < 0 || target.jobSearch > 1440;
            return (
              <div
                key={day}
                className={styles.targetCard}
                role="group"
                aria-labelledby={`target-${day}-label`}
              >
                <span id={`target-${day}-label`} className={styles.targetDay}>
                  {DAY_LABELS[day]}
                </span>
                <label className={styles.targetField}>
                  <span className={styles.targetLabel}>Work</span>
                  <input
                    className={`${styles.targetInput} ${workInvalid ? styles.inputError : ""}`}
                    type="number"
                    min={0}
                    max={1440}
                    step={15}
                    inputMode="numeric"
                    value={target.work < 0 ? "" : target.work}
                    aria-label={`${DAY_LABELS[day]} work minutes`}
                    aria-invalid={workInvalid}
                    onChange={(event) => onTargetChange(day, "work", event.target.value)}
                  />
                </label>
                <label className={styles.targetField}>
                  <span className={styles.targetLabel}>Job</span>
                  <input
                    className={`${styles.targetInput} ${searchInvalid ? styles.inputError : ""}`}
                    type="number"
                    min={0}
                    max={1440}
                    step={15}
                    inputMode="numeric"
                    value={target.jobSearch < 0 ? "" : target.jobSearch}
                    aria-label={`${DAY_LABELS[day]} job-search minutes`}
                    aria-invalid={searchInvalid}
                    onChange={(event) =>
                      onTargetChange(day, "jobSearch", event.target.value)
                    }
                  />
                </label>
              </div>
            );
          })}
        </div>
        <p className={styles.targetTotal}>
          Targets are guidance, not tracked time. Empty or out-of-range values
          must be fixed before the schedule can be saved.
        </p>
      </div>
    </section>
  );
}
