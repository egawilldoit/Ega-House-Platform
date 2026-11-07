import type { CSSProperties } from "react";

import { getGuidanceColor } from "./guidance-colors";
import styles from "./preferences.module.css";
import {
  DAYS,
  DAY_LABELS,
  type Day,
  type GuidanceBlock,
  type GuidanceConflicts,
  formatHours,
  getPlannerRange,
  parseTimeToMinutes,
} from "./schedule-model";

type ColorStyle = CSSProperties & { "--block-color": string };

const HOUR_HEIGHT = 44;

export function WeeklyPlanner({
  guidance,
  targets,
  conflicts,
  selectedIndex,
  paused,
  onSelect,
}: {
  guidance: readonly GuidanceBlock[];
  targets: Record<Day, number>;
  conflicts: GuidanceConflicts;
  selectedIndex: number;
  paused: boolean;
  onSelect: (index: number) => void;
}) {
  const range = getPlannerRange(guidance);
  const hours = Array.from(
    { length: Math.max(1, range.endHour - range.startHour) },
    (_, offset) => range.startHour + offset,
  );
  const bodyHeight = (range.endHour - range.startHour) * HOUR_HEIGHT;

  return (
    <section className={styles.panel} aria-labelledby="weekly-planner-title">
      <div className={styles.panelHeader}>
        <div>
          <h2 id="weekly-planner-title" className={styles.panelTitle}>
            Weekly planner
          </h2>
          <p className={styles.panelDescription}>
            Guidance only. Blocks show the days, start, end and enabled state
            stored on your account; they never create timers or calendar entries.
          </p>
        </div>
        <span className={paused ? styles.pausedBadge : styles.activeBadge}>
          <span className={styles.badgeDot} aria-hidden="true" />
          {paused ? "Paused" : "Active"}
        </span>
      </div>

      <BlockLegend
        guidance={guidance}
        selectedIndex={selectedIndex}
        onSelect={onSelect}
      />

      <div
        className={`${styles.plannerScroll} ${paused ? styles.plannerPaused : ""}`}
        tabIndex={0}
        aria-label="Weekly guidance planner. Scroll horizontally to see every day."
      >
        <div className={styles.planner}>
          <div className={styles.corner} aria-hidden="true" />
          {DAYS.map((day) => (
            <div key={day} className={styles.dayHeader}>
              <span className={styles.dayHeaderName}>{DAY_LABELS[day]}</span>
              <span className={styles.dayHeaderMeta}>
                {targets[day] > 0 ? `${formatHours(targets[day])} work` : "No work target"}
              </span>
            </div>
          ))}

          <div className={styles.axis} style={{ height: bodyHeight }} aria-hidden="true">
            {hours.map((hour) => (
              <div key={hour} className={styles.hourTick}>
                {String(hour).padStart(2, "0")}:00
              </div>
            ))}
          </div>

          {DAYS.map((day) => (
            <div
              key={day}
              className={styles.dayColumn}
              style={{ height: bodyHeight }}
              aria-label={`${DAY_LABELS[day]} guidance`}
              role="group"
            >
              {guidance.map((block, index) => {
                if (!block.days.includes(day)) return null;
                const start = parseTimeToMinutes(block.start);
                const end = parseTimeToMinutes(block.end);
                const conflicted = conflicts.badKeys.has(`${index}:${day}`);
                const top =
                  start === null
                    ? 0
                    : ((start - range.startHour * 60) / 60) * HOUR_HEIGHT;
                const requestedHeight =
                  start === null || end === null
                    ? HOUR_HEIGHT / 2
                    : ((end - start) / 60) * HOUR_HEIGHT;
                const height = Math.max(
                  18,
                  Math.min(requestedHeight, bodyHeight - Math.max(0, top)),
                );

                return (
                  <button
                    key={`${index}-${day}`}
                    type="button"
                    className={[
                      styles.block,
                      block.enabled ? "" : styles.blockDisabled,
                      selectedIndex === index ? styles.blockSelected : "",
                      conflicted ? styles.blockConflict : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    style={
                      {
                        top: Math.max(0, top),
                        height,
                        "--block-color": getGuidanceColor(block.name),
                      } as ColorStyle
                    }
                    aria-pressed={selectedIndex === index}
                    aria-label={`${block.name} on ${DAY_LABELS[day]} from ${block.start} to ${block.end}${block.enabled ? "" : ", disabled"}${conflicted ? ", overlaps another block" : ""}`}
                    onClick={() => onSelect(index)}
                  >
                    {block.name}
                    <span className={styles.blockTime}>
                      {block.start}–{block.end}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className={styles.plannerFooter}>
        <span>
          {range.startHour === 0 ? "00:00" : `${String(range.startHour).padStart(2, "0")}:00`}
          {" – "}
          {String(range.endHour).padStart(2, "0")}:00
        </span>
        <span>
          {paused
            ? "Schedule paused: blocks stay visible but no upcoming guidance is reported."
            : "Select any block or legend item to edit it. Scroll sideways for every day."}
        </span>
      </div>
    </section>
  );
}

export function BlockLegend({
  guidance,
  selectedIndex,
  onSelect,
}: {
  guidance: readonly GuidanceBlock[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}) {
  return (
    <div className={styles.legend} role="group" aria-label="Guidance types">
      {guidance.map((block, index) => (
        <button
          key={`${index}-${block.name}`}
          type="button"
          className={styles.legendItem}
          aria-pressed={selectedIndex === index}
          onClick={() => onSelect(index)}
        >
          <span
            className={styles.swatch}
            aria-hidden="true"
            style={{ "--block-color": getGuidanceColor(block.name) } as ColorStyle}
          />
          {block.name}
          {block.enabled ? null : <span className={styles.srOnly}> (disabled)</span>}
        </button>
      ))}
    </div>
  );
}
