"use client";

import { useReducedMotion } from "motion/react";

import { AuthMotionDiv } from "./auth-motion";

type AuthGeometryProps = {
  variant: "focus" | "orbit";
};

export function AuthGeometry({ variant }: AuthGeometryProps) {
  const reduceMotion = useReducedMotion();

  if (variant === "focus") {
    return (
      <div className="auth-geometry auth-geometry--focus" aria-hidden="true">
        <AuthMotionDiv
          className="auth-focus-orbit auth-focus-orbit--outer"
          animate={reduceMotion ? undefined : { rotate: [-7, 7, -7] }}
          transition={{ duration: 14, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
        />
        <AuthMotionDiv
          className="auth-focus-orbit auth-focus-orbit--inner"
          animate={reduceMotion ? undefined : { rotate: [8, -8, 8] }}
          transition={{ duration: 11, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
        />
        <span className="auth-focus-core" />
        <span className="auth-focus-number">01</span>
      </div>
    );
  }

  return (
    <div className="auth-geometry auth-geometry--orbit" aria-hidden="true">
      <AuthMotionDiv
        className="auth-orbit auth-orbit--signal"
        animate={reduceMotion ? undefined : { rotate: [-24, -14, -24] }}
        transition={{ duration: 13, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
      />
      <AuthMotionDiv
        className="auth-orbit auth-orbit--blue"
        animate={reduceMotion ? undefined : { rotate: [24, 14, 24] }}
        transition={{ duration: 15, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
      />
      <span className="auth-orbit-signal">02</span>
    </div>
  );
}
