import type { TimelineArrow } from "@/lib/task-timeline";

import styles from "./timeline.module.css";

type DependencyArrowsProps = Readonly<{
  arrows: TimelineArrow[];
  dayWidth: number;
  rowHeight: number;
  rowCount: number;
  width: number;
}>;

/**
 * Decorative dependency arrows.
 *
 * The text dependency list below the timeline is the accessible equivalent;
 * this SVG is hidden from assistive technology. Only edges whose two endpoints
 * are both visible scheduled rows are rendered.
 */
export function DependencyArrows({
  arrows,
  dayWidth,
  rowHeight,
  rowCount,
  width,
}: DependencyArrowsProps) {
  if (arrows.length === 0) return null;

  const height = Math.max(rowHeight, rowCount * rowHeight);

  return (
    <svg
      className={styles.arrows}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <marker
          id="timeline-dependency-arrowhead"
          markerWidth="6"
          markerHeight="6"
          refX="5"
          refY="3"
          orient="auto"
        >
          <path className={styles.arrowHead} d="M0,0 L6,3 L0,6 Z" />
        </marker>
      </defs>
      {arrows.map((arrow) => {
        const fromX = (arrow.fromOffset + 1) * dayWidth;
        const toX = arrow.toOffset * dayWidth;
        const fromY = arrow.fromRow * rowHeight + rowHeight / 2;
        const toY = arrow.toRow * rowHeight + rowHeight / 2;
        const curve = Math.max(18, Math.min(56, Math.abs(toX - fromX) / 2));
        const path = `M ${fromX} ${fromY} C ${fromX + curve} ${fromY}, ${toX - curve} ${toY}, ${toX} ${toY}`;

        return (
          <path
            key={`${arrow.fromTaskId}-${arrow.toTaskId}`}
            className={styles.arrowPath}
            d={path}
            markerEnd="url(#timeline-dependency-arrowhead)"
          />
        );
      })}
    </svg>
  );
}
