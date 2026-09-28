"use client";

import { useDisplayTimezone } from "./use-display-timezone";

/**
 * Installs the owner's persisted EGA House timezone as the central formatter's
 * display-timezone override for the client session. Renders nothing.
 */
export function DisplayTimezoneBootstrap() {
  useDisplayTimezone();
  return null;
}
