"use client";

import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * First-render count-up for Home stat values.
 *
 * The server renders the final value, so the page is correct without JS. On the
 * first client render the value counts up only when the user has not asked for
 * reduced motion; later prop changes (for example a realtime refresh) update
 * immediately instead of replaying the animation. While the number is moving,
 * the animated text is hidden from assistive tech and the final value is exposed
 * once, so a screen reader never reads a stream of intermediate totals.
 */
export function HomeCountValue({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const hasAnimated = useRef(false);
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    if (hasAnimated.current) {
      const frame = requestAnimationFrame(() => setDisplay(value));
      return () => cancelAnimationFrame(frame);
    }

    hasAnimated.current = true;

    if (reduceMotion || value <= 0) {
      const frame = requestAnimationFrame(() => setDisplay(value));
      return () => cancelAnimationFrame(frame);
    }

    const duration = Math.min(720, 260 + value * 14);
    const startedAt = performance.now();
    let frame = 0;

    const step = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - (1 - progress) ** 3;
      setDisplay(Math.round(value * eased));
      if (progress < 1) {
        frame = requestAnimationFrame(step);
      }
    };

    frame = requestAnimationFrame(() => {
      setDisplay(0);
      frame = requestAnimationFrame(step);
    });

    return () => cancelAnimationFrame(frame);
  }, [reduceMotion, value]);

  const isAnimating = display !== value;

  return (
    <span className={cn("tabular-nums", className)} data-testid="home-count-value">
      <span aria-hidden={isAnimating ? "true" : undefined}>
        {new Intl.NumberFormat("en-US").format(display)}
      </span>
      {isAnimating ? <span className="sr-only">{value}</span> : null}
    </span>
  );
}
