import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

// New instrument tones
type InstrumentTone = "active" | "muted" | "warn" | "error" | "info";

// Legacy tones from getTaskStatusTone() — mapped to instrument equivalents
type LegacyTone = "success" | "danger" | "accent" | "neutral";

type BadgeTone = InstrumentTone | LegacyTone;

function resolveTone(tone: BadgeTone): string {
  const map: Record<BadgeTone, string> = {
    // Instrument tones
    active: "status-badge status-badge-active",
    muted:  "status-badge status-badge-muted",
    warn:   "status-badge status-badge-warn",
    error:  "status-badge status-badge-error",
    info:   "status-badge status-badge-info",
    // Legacy → instrument mapping
    success: "status-badge status-badge-active",
    danger:  "status-badge status-badge-error",
    accent:  "status-badge status-badge-info",
    neutral: "status-badge status-badge-muted",
  };
  return map[tone] ?? map.muted;
}

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
};

export function Badge({ className, tone = "muted", ...props }: BadgeProps) {
  return (
    <span className={cn(resolveTone(tone), className)} {...props} />
  );
}
