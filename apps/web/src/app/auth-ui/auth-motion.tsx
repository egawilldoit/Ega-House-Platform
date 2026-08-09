"use client";

import { motion, MotionConfig, type Variants } from "motion/react";
import type { ReactNode } from "react";

const revealVariants: Variants = {
  hidden: { opacity: 0, y: 22 },
  visible: { opacity: 1, y: 0 },
};

type AuthMotionProps = {
  children: ReactNode;
};

export function AuthMotion({ children }: AuthMotionProps) {
  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.52, ease: [0.22, 1, 0.36, 1] }}>
      {children}
    </MotionConfig>
  );
}

type AuthRevealProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
};

export function AuthReveal({ children, className, delay = 0 }: AuthRevealProps) {
  return (
    <motion.div
      className={className}
      variants={revealVariants}
      initial="hidden"
      animate="visible"
      transition={{ delay, duration: 0.52, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

export const AuthMotionDiv = motion.div;
