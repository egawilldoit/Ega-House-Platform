import {
  BookOpen,
  Briefcase,
  Compass,
  Dumbbell,
  Folder,
  HeartPulse,
  Home,
  Sparkles,
  Target,
  type LucideIcon,
} from "lucide-react";

import { DEFAULT_AREA_COLOR, DEFAULT_AREA_ICON, type AreaColor, type AreaIcon } from "@ega/domain";
import { cn } from "@/lib/utils";

const AREA_ICONS: Record<AreaIcon, LucideIcon> = {
  folder: Folder,
  briefcase: Briefcase,
  dumbbell: Dumbbell,
  compass: Compass,
  sparkles: Sparkles,
  home: Home,
  "heart-pulse": HeartPulse,
  "book-open": BookOpen,
  target: Target,
};

const AREA_COLORS: Record<AreaColor, string> = {
  blue: "var(--ega-data-blue)",
  orange: "var(--ega-data-orange)",
  purple: "var(--ega-data-purple)",
  green: "var(--ega-data-green)",
  yellow: "var(--ega-data-yellow)",
  slate: "var(--ega-data-slate)",
  red: "var(--status-overdue)",
  teal: "var(--status-healthy)",
};

export function resolveAreaIcon(value: string | null | undefined): AreaIcon {
  return value && value in AREA_ICONS ? (value as AreaIcon) : DEFAULT_AREA_ICON;
}

export function resolveAreaColor(value: string | null | undefined): AreaColor {
  return value && value in AREA_COLORS ? (value as AreaColor) : DEFAULT_AREA_COLOR;
}

/** Lucide icon for an Area. Never a second icon framework or arbitrary import. */
export function AreaIconView({
  icon,
  className,
}: {
  icon: string | null | undefined;
  className?: string;
}) {
  const Icon = AREA_ICONS[resolveAreaIcon(icon)];

  return <Icon aria-hidden="true" className={cn("h-3.5 w-3.5 shrink-0", className)} />;
}

/** Token-backed colour mark for an Area, used beside its icon/name. */
export function AreaColorDot({
  color,
  className,
}: {
  color: string | null | undefined;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full", className)}
      style={{ background: AREA_COLORS[resolveAreaColor(color)] }}
    />
  );
}
