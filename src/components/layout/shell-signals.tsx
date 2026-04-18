import React from "react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import type { WorkspaceShellMetrics } from "@/lib/workspace-shell";
import { cn } from "@/lib/utils";

type SidebarShellBadge = {
  label: string;
  tone: "active" | "warn" | "error" | "muted";
};

type TopBarShellSignal = {
  href: `/${string}`;
  label: string;
  tone: "active" | "warn" | "error" | "muted";
};

export function getSidebarTaskSignalBadge(
  metrics: WorkspaceShellMetrics,
): SidebarShellBadge | null {
  if (metrics.overdueTaskCount > 0) {
    return {
      label: String(metrics.overdueTaskCount),
      tone: "error",
    };
  }

  if (metrics.dueTodayTaskCount > 0) {
    return {
      label: String(metrics.dueTodayTaskCount),
      tone: "warn",
    };
  }

  if (metrics.blockedTaskCount > 0) {
    return {
      label: String(metrics.blockedTaskCount),
      tone: "muted",
    };
  }

  return null;
}

export function getTopBarShellSignals(
  metrics: WorkspaceShellMetrics,
): TopBarShellSignal[] {
  const signals: TopBarShellSignal[] = [];

  if (metrics.hasActiveTimer) {
    signals.push({
      href: "/timer",
      label: "Timer active",
      tone: "active",
    });
  }

  if (metrics.overdueTaskCount > 0) {
    signals.push({
      href: "/tasks?due=overdue",
      label: `${metrics.overdueTaskCount} overdue`,
      tone: "error",
    });
  }

  if (metrics.dueTodayTaskCount > 0) {
    signals.push({
      href: "/tasks?due=due_today",
      label: `${metrics.dueTodayTaskCount} due today`,
      tone: "warn",
    });
  }

  if (metrics.blockedTaskCount > 0) {
    signals.push({
      href: "/tasks?status=blocked",
      label: `${metrics.blockedTaskCount} blocked`,
      tone: "muted",
    });
  }

  if (metrics.reviewMissing) {
    signals.push({
      href: "/review",
      label: "Review due",
      tone: "warn",
    });
  }

  return signals;
}

export function SidebarSignalBadge({
  label,
  tone,
  className,
}: SidebarShellBadge & { className?: string }) {
  return (
    <span
      className={cn("sidebar-badge", `sidebar-badge-${tone}`, className)}
      aria-label={label}
    >
      {label}
    </span>
  );
}

export function TopBarSignalCluster({ metrics }: { metrics: WorkspaceShellMetrics }) {
  const signals = getTopBarShellSignals(metrics);

  if (signals.length === 0) {
    return null;
  }

  return (
    <div className="hidden items-center gap-2 xl:flex">
      {signals.map((signal) => (
        <Link key={signal.label} href={signal.href}>
          <Badge tone={signal.tone}>{signal.label}</Badge>
        </Link>
      ))}
    </div>
  );
}
