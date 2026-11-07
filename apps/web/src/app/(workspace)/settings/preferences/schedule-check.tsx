import styles from "./preferences.module.css";
import {
  DAYS,
  DAY_LABELS,
  type GuidanceConflicts,
  type NextGuidance,
  type Schedule,
  formatDuration,
  getNextGuidance,
  getPlannedGuidanceMinutes,
} from "./schedule-model";

function nextDetail(next: NextGuidance): string {
  const when =
    next.dayOffset === 0
      ? "Today"
      : next.dayOffset === 1
        ? "Tomorrow"
        : next.dayOffset === 7
          ? `Next ${DAY_LABELS[next.day]}`
          : DAY_LABELS[next.day];

  if (next.startsInMinutes <= 0) return `${when} at ${next.start}`;
  if (next.startsInMinutes < 60) {
    return `${when} at ${next.start}, in ${next.startsInMinutes} min`;
  }
  return `${when} at ${next.start}, in ${formatDuration(next.startsInMinutes)}`;
}

export function ScheduleCheck({
  schedule,
  conflicts,
  timezone,
  now,
}: {
  schedule: Schedule;
  conflicts: GuidanceConflicts;
  timezone: string | null;
  now: Date | null;
}) {
  const hasConflicts = conflicts.messages.length > 0;
  const planned = getPlannedGuidanceMinutes(schedule.guidance);
  const maxPlanned = Math.max(1, ...DAYS.map((day) => planned[day]));
  const next = timezone && now ? getNextGuidance(schedule, timezone, now) : null;

  let nextTitle = "Next guidance";
  let nextText = "Checking your schedule…";
  if (schedule.paused) {
    nextTitle = "Schedule paused";
    nextText = "Upcoming guidance is hidden while the schedule is paused.";
  } else if (!timezone) {
    nextText = "The account time zone is unavailable, so upcoming guidance cannot be shown.";
  } else if (!now) {
    nextText = "Checking your schedule in your account time zone…";
  } else if (next) {
    nextTitle = `Next: ${next.name}`;
    nextText = nextDetail(next);
  } else {
    nextText = "No enabled guidance in the next seven days.";
  }

  return (
    <aside className={styles.panel} aria-labelledby="schedule-check-title">
      <div className={styles.panelHeader}>
        <div>
          <h2 id="schedule-check-title" className={styles.panelTitle}>
            Schedule check
          </h2>
          <p className={styles.panelDescription}>
            Client-side guidance only. It creates no timers, reminders or
            calendar entries.
          </p>
        </div>
      </div>

      <div className={styles.checkBody}>
        <div className={styles.checkItem}>
          <span
            className={`${styles.checkIcon} ${hasConflicts ? styles.checkIconBad : styles.checkIconOk}`}
            aria-hidden="true"
          >
            {hasConflicts ? "!" : "✓"}
          </span>
          <div>
            <span className={styles.checkTitle}>
              {hasConflicts
                ? `${conflicts.messages.length} ${conflicts.messages.length === 1 ? "problem" : "problems"}`
                : "No enabled overlaps"}
            </span>
            <span className={styles.checkDetail}>
              {hasConflicts
                ? conflicts.messages.join(" ")
                : "Every enabled block has its own time."}
            </span>
          </div>
        </div>

        <div className={styles.checkItem}>
          <span className={styles.checkIcon} aria-hidden="true">
            →
          </span>
          <div>
            <span className={styles.checkTitle}>{nextTitle}</span>
            <span className={styles.checkDetail}>{nextText}</span>
            {timezone ? (
              <span className={styles.checkDetail}>Account time zone: {timezone}</span>
            ) : null}
          </div>
        </div>

        <div className={styles.checkItem}>
          <span className={styles.checkIcon} aria-hidden="true">
            ▤
          </span>
          <div style={{ minWidth: 0, width: "100%" }}>
            <span className={styles.checkTitle}>Planned guidance per day</span>
            <div className={styles.dayBars} aria-hidden="true">
              {DAYS.map((day) => (
                <span
                  key={day}
                  className={planned[day] > 0 ? styles.dayBar : styles.dayBarEmpty}
                  style={{ height: `${Math.max(3, (planned[day] / maxPlanned) * 34)}px` }}
                  title={`${DAY_LABELS[day]}: ${planned[day]} minutes`}
                />
              ))}
            </div>
            <div className={styles.dayBarLabels} aria-hidden="true">
              {DAYS.map((day) => (
                <span key={day}>{DAY_LABELS[day].slice(0, 3)}</span>
              ))}
            </div>
            <span className={styles.srOnly}>
              Planned guidance minutes:{" "}
              {DAYS.map((day) => `${DAY_LABELS[day]} ${planned[day]}`).join(", ")}.
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}
