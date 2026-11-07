import type { PersonalOperationsDayPlanResult } from "@ega/domain/preferences";

import styles from "./preferences.module.css";
import {
  DAYS,
  DAY_LABELS,
  type GuidanceConflicts,
  type NextGuidance,
  type PersonalOperationsTimeContext,
  type Schedule,
  formatDuration,
  getNextGuidance,
  getPlannedGuidanceMinutes,
  isValidTimeZone,
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

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function ScheduleCheck({
  schedule,
  conflicts,
  timeContext,
  today,
  now,
}: {
  schedule: Schedule;
  conflicts: GuidanceConflicts;
  timeContext: PersonalOperationsTimeContext | null;
  today: PersonalOperationsDayPlanResult | null;
  now: Date | null;
}) {
  const hasConflicts = conflicts.messages.length > 0;
  const planned = getPlannedGuidanceMinutes(schedule.guidance);
  const maxPlanned = Math.max(1, ...DAYS.map((day) => planned[day]));

  const effectiveTimezone = timeContext?.timezone ?? null;
  const storedTimezone = timeContext?.persistedTimezone ?? null;
  const invalidTimezone =
    timeContext !== null &&
    (timeContext.fallback === "invalid_timezone" ||
      (storedTimezone !== null && !isValidTimeZone(storedTimezone)) ||
      (effectiveTimezone !== null && !isValidTimeZone(effectiveTimezone)));
  const fallbackMissing = timeContext?.fallback === "missing_timezone";
  const hasUsableTimezone =
    effectiveTimezone !== null && !invalidTimezone && isValidTimeZone(effectiveTimezone);
  const next =
    effectiveTimezone !== null && hasUsableTimezone && now
      ? getNextGuidance(schedule, effectiveTimezone, now)
      : null;
  const timezoneLabel = invalidTimezone
    ? (storedTimezone ?? effectiveTimezone)
    : effectiveTimezone;

  let nextTitle = "Next guidance";
  let nextText: string;
  if (schedule.paused) {
    nextTitle = "Schedule paused";
    nextText = "Upcoming guidance is hidden while the schedule is paused.";
  } else if (!timeContext) {
    nextText =
      "The account time zone is unavailable, so upcoming guidance cannot be shown.";
  } else if (invalidTimezone) {
    nextTitle = "Time zone unavailable";
    nextText = `"${timezoneLabel}" is not a valid IANA time zone, so upcoming guidance cannot be shown.`;
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
            {timeContext ? (
              <span className={styles.checkDetail}>
                Account time zone: {timezoneLabel}
                {invalidTimezone ? " (invalid)" : ""}
              </span>
            ) : null}
            {fallbackMissing ? (
              <span className={styles.checkDetail} role="status">
                No time zone is stored for this account, so UTC is used for day
                boundaries. Set a time zone in Account settings.
              </span>
            ) : null}
            {!timeContext ? (
              <span className={styles.checkDetail} role="status">
                The account time zone could not be loaded right now. You can still
                edit and save the schedule; today&apos;s plan is unavailable.
              </span>
            ) : null}
          </div>
        </div>

        <div className={styles.checkItem}>
          <span className={styles.checkIcon} aria-hidden="true">
            ◎
          </span>
          <div style={{ minWidth: 0 }}>
            <span className={styles.checkTitle}>Today&apos;s plan</span>
            {timeContext === null ? (
              <span className={styles.checkDetail}>
                Today&apos;s plan is unavailable because the account time zone
                could not be loaded.
              </span>
            ) : today === null ? (
              <span className={styles.checkDetail}>
                Resolving today in your account time zone…
              </span>
            ) : !today.ok ? (
              <span role="alert" className={styles.inlineError}>
                {today.message}
              </span>
            ) : (
              <>
                <span className={styles.checkDetail}>
                  Today in {timeContext.timezone}:{" "}
                  <strong>{capitalize(today.value.day)}</strong> —{" "}
                  {today.value.target.work} min work,{" "}
                  {today.value.target.jobSearch} min job search
                  {today.value.paused ? " (paused)" : ""}
                </span>
                {today.value.guidance.length > 0 ? (
                  <ul aria-label="Today's guidance" className={styles.todayGuidance}>
                    {today.value.guidance.map((guidance, index) => (
                      <li key={`${guidance.name}-${guidance.start}-${index}`}>
                        {guidance.name}: {guidance.start}–{guidance.end}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className={styles.checkDetail}>
                    No guidance blocks are enabled for today.
                  </span>
                )}
              </>
            )}
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
