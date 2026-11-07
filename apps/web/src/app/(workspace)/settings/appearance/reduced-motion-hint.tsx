"use client";

import { useSyncExternalStore } from "react";

import styles from "./appearance.module.css";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(QUERY);
  if (typeof query.addEventListener === "function") {
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }
  query.addListener?.(onChange);
  return () => query.removeListener?.(onChange);
}

function readPreference(): boolean {
  if (typeof window.matchMedia !== "function") return false;
  return window.matchMedia(QUERY).matches;
}

/**
 * Reports the device-level motion request without changing it.
 *
 * The control's saved value is authoritative for the app; the OS request is
 * always honoured on top by MotionConfig. This hint only explains when the
 * device is currently asking for less motion, so the owner can distinguish it
 * from their own saved preference. The server snapshot is null so the sentence
 * appears only after hydration and cannot mismatch.
 */
export function ReducedMotionHint() {
  const prefersReducedMotion = useSyncExternalStore<boolean | null>(
    subscribe,
    readPreference,
    () => null,
  );

  if (prefersReducedMotion === null) return null;

  return (
    <p className={styles.motionHint} role="status">
      {prefersReducedMotion
        ? "This device is currently requesting reduced motion, so it applies even when the saved switch is off."
        : "This device is not requesting reduced motion. The saved switch still applies."}
    </p>
  );
}
