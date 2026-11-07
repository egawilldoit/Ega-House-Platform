import styles from "./preferences.module.css";
import {
  DAYS,
  type Schedule,
  formatHours,
  getWeeklyTotals,
} from "./schedule-model";

function MiniBars({ values, jobSearch = false }: { values: number[]; jobSearch?: boolean }) {
  const max = Math.max(1, ...values);
  return (
    <span
      className={`${styles.sparkline} ${jobSearch ? styles.sparklineJob : ""}`}
      aria-hidden="true"
    >
      {values.map((value, index) => (
        <span
          key={index}
          style={{ height: `${Math.max(3, (Math.max(0, value) / max) * 26)}px` }}
        />
      ))}
    </span>
  );
}

export function SummaryStrip({
  schedule,
  onPauseChange,
}: {
  schedule: Schedule;
  onPauseChange: (paused: boolean) => void;
}) {
  const totals = getWeeklyTotals(schedule);

  return (
    <section className={styles.panel} aria-label="Schedule summary">
      <div className={styles.summary}>
        <div className={styles.summaryCell}>
          <span className={styles.summaryLabel}>Weekly work target</span>
          <div className={styles.summaryValueRow}>
            <p className={styles.summaryValue}>{formatHours(totals.work)}</p>
            <MiniBars values={DAYS.map((day) => schedule.targets[day].work)} />
          </div>
          <p className={styles.summaryMeta}>{totals.work.toLocaleString("en-US")} minutes per week</p>
        </div>

        <div className={styles.summaryCell}>
          <span className={styles.summaryLabel}>Weekly job-search target</span>
          <div className={styles.summaryValueRow}>
            <p className={styles.summaryValue}>{formatHours(totals.jobSearch)}</p>
            <MiniBars
              values={DAYS.map((day) => schedule.targets[day].jobSearch)}
              jobSearch
            />
          </div>
          <p className={styles.summaryMeta}>
            {totals.jobSearch.toLocaleString("en-US")} minutes per week
          </p>
        </div>

        <div className={styles.summaryCell}>
          <span className={styles.summaryLabel}>Schedule state</span>
          <div className={styles.summaryValueRow}>
            <p className={styles.summaryValue}>
              {schedule.paused ? "Paused" : "Active"}
            </p>
            <label className={styles.switch}>
              <input
                type="checkbox"
                checked={!schedule.paused}
                onChange={(event) => onPauseChange(!event.target.checked)}
                aria-label="Schedule active"
              />
              <span className={styles.switchTrack} aria-hidden="true" />
            </label>
          </div>
          <p className={styles.summaryMeta}>
            {schedule.paused
              ? "Targets are retained; upcoming guidance is hidden."
              : "Guidance is visible in the planner."}
          </p>
        </div>
      </div>
    </section>
  );
}
