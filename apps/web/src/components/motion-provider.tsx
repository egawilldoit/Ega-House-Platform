"use client";

import type { ReactNode } from "react";

// MotionConfig from `motion` (v12) — canonical import is `motion/react`.
import { MotionConfig } from "motion/react";

export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
