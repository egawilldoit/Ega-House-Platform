"use client";

import type { ReactNode } from "react";

// MotionConfig from `motion` (v12) — canonical import is `motion/react`.
import { MotionConfig } from "motion/react";

/**
 * Workspace motion provider.
 *
 * `reducedMotion="user"` already follows the OS request. The explicit owner
 * preference upgrades the same provider to `"always"`, so an app-level choice
 * and the OS setting stay coherent instead of fighting each other: either one
 * asking for less motion wins.
 */
export function MotionProvider({
  children,
  reducedMotion = false,
}: {
  children: ReactNode;
  reducedMotion?: boolean;
}) {
  return (
    <MotionConfig reducedMotion={reducedMotion ? "always" : "user"}>
      {children}
    </MotionConfig>
  );
}
