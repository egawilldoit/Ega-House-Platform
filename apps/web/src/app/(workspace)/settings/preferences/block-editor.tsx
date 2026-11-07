import type { CSSProperties, Ref } from "react";

import { getGuidanceColor } from "./guidance-colors";
import styles from "./preferences.module.css";
import {
  DAYS,
  DAY_LABELS,
  type Day,
  type GuidanceBlock,
  formatDuration,
  parseTimeToMinutes,
} from "./schedule-model";

type ColorStyle = CSSProperties & { "--block-color": string };

export function BlockEditor({
  block,
  index,
  conflictMessages,
  headingRef,
  onChange,
}: {
  block: GuidanceBlock;
  index: number;
  conflictMessages: readonly string[];
  headingRef?: Ref<HTMLHeadingElement>;
  onChange: (patch: Partial<GuidanceBlock>) => void;
}) {
  const start = parseTimeToMinutes(block.start);
  const end = parseTimeToMinutes(block.end);
  const duration = start !== null && end !== null && end > start ? end - start : 0;
  const invalidRange = start === null || end === null || end <= start;
  const errorId = `guidance-${index}-error`;
  const hasErrors = invalidRange || conflictMessages.length > 0;

  function toggleDay(day: Day) {
    const nextDays = block.days.includes(day)
      ? block.days.filter((item) => item !== day)
      : DAYS.filter(
          (candidate) => candidate === day || block.days.includes(candidate),
        );
    onChange({ days: nextDays });
  }

  return (
    <section
      className={`${styles.panel} ${styles.editor}`}
      style={{ "--block-color": getGuidanceColor(block.name) } as ColorStyle}
      aria-labelledby={`guidance-${index}-title`}
    >
      <div className={styles.panelHeader}>
        <div className={styles.editorTop}>
          <div className={styles.editorIdentity}>
            <span
              className={styles.swatch}
              aria-hidden="true"
              style={{ "--block-color": getGuidanceColor(block.name) } as ColorStyle}
            />
            <h2
              id={`guidance-${index}-title`}
              ref={headingRef}
              tabIndex={-1}
              className={styles.editorName}
            >
              {block.name}
            </h2>
          </div>
          <label className={styles.switch}>
            <input
              type="checkbox"
              checked={block.enabled}
              onChange={(event) => onChange({ enabled: event.target.checked })}
              aria-label={`Enable ${block.name}`}
            />
            <span className={styles.switchTrack} aria-hidden="true" />
          </label>
        </div>
        <p className={styles.panelDescription}>
          {block.enabled
            ? "Enabled. This block appears on the days below."
            : "Disabled. It stays on the planner as a dashed outline and is ignored by overlap checks."}
        </p>
      </div>

      <div className={styles.panelBody}>
        <div className={styles.fieldRow}>
          <label className={styles.field} htmlFor={`guidance-${index}-start`}>
            <span className={styles.fieldLabel}>Start</span>
            <input
              id={`guidance-${index}-start`}
              className={`${styles.input} ${invalidRange ? styles.inputError : ""}`}
              type="time"
              value={block.start}
              required
              aria-invalid={invalidRange}
              aria-describedby={hasErrors ? errorId : undefined}
              onChange={(event) => onChange({ start: event.target.value })}
            />
          </label>
          <label className={styles.field} htmlFor={`guidance-${index}-end`}>
            <span className={styles.fieldLabel}>End</span>
            <input
              id={`guidance-${index}-end`}
              className={`${styles.input} ${invalidRange ? styles.inputError : ""}`}
              type="time"
              value={block.end}
              required
              aria-invalid={invalidRange}
              aria-describedby={hasErrors ? errorId : undefined}
              onChange={(event) => onChange({ end: event.target.value })}
            />
          </label>
        </div>

        <div className={styles.daysRow} role="group" aria-label={`${block.name} weekdays`}>
          {DAYS.map((day) => (
            <button
              key={day}
              type="button"
              className={styles.dayToggle}
              aria-pressed={block.days.includes(day)}
              aria-label={DAY_LABELS[day]}
              onClick={() => toggleDay(day)}
            >
              {DAY_LABELS[day].slice(0, 3)}
            </button>
          ))}
        </div>

        <div className={styles.editorFooter}>
          <span className={styles.durationPill}>
            {duration > 0 ? formatDuration(duration) : "0 min"}
          </span>
          <span className={styles.editorStatus}>
            {block.days.length === 0
              ? "No weekdays selected; this block is not drawn."
              : `${block.days.length} ${block.days.length === 1 ? "day" : "days"} selected`}
          </span>
        </div>

        {hasErrors ? (
          <p id={errorId} className={styles.inlineError}>
            {invalidRange
              ? "End time must be after start time."
              : conflictMessages.join(" ")}
          </p>
        ) : null}
      </div>
    </section>
  );
}
