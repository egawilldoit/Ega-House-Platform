"use client";

import type { KeyboardEvent } from "react";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowRight, LayoutDashboard, Target, Timer, ListChecks, NotebookTabs } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { AppsLauncherIconKey, AppsLauncherItem } from "./launcher-items";
import { focusShellHeadingFromShortcutNavigation } from "@/components/layout/workspace-keyboard-shortcuts";
import { useCanonicalUrl } from "@/lib/use-canonical-url";

import { getNextLauncherIndex, isLauncherActivationKey } from "./launcher-navigation";

const ICON_MAP: Record<AppsLauncherIconKey, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard,
  tasks: ListChecks,
  timer: Timer,
  goals: Target,
  review: NotebookTabs,
};

type AppsLauncherGridProps = {
  items: AppsLauncherItem[];
};

export function AppsLauncherGrid({ items }: AppsLauncherGridProps) {
  const tileRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const canonicalUrl = useCanonicalUrl();

  useEffect(() => {
    const focusId = window.requestAnimationFrame(() => {
      const marker = window.sessionStorage.getItem("ega:shortcut-route-target");
      if (marker === "/apps") {
        tileRefs.current[0]?.focus();
        window.sessionStorage.removeItem("ega:shortcut-route-target");
        return;
      }

      focusShellHeadingFromShortcutNavigation("/apps");
    });

    return () => window.cancelAnimationFrame(focusId);
  }, []);

  const handleTileKeyDown = (event: KeyboardEvent<HTMLAnchorElement>, index: number) => {
    const nextIndex = getNextLauncherIndex({
      currentIndex: index,
      key: event.key,
      totalItems: items.length,
      columns: 1,
    });

    if (nextIndex !== null) {
      event.preventDefault();
      tileRefs.current[nextIndex]?.focus();
      return;
    }

    if (isLauncherActivationKey(event.key)) {
      event.preventDefault();
      event.currentTarget.click();
    }
  };

  return (
    <section aria-label="Apps launcher">
      <Card>
        <div className="rows">
          {items.map((item, index) => {
            const Icon = ICON_MAP[item.icon];
            return (
              <Link
                key={item.id}
                href={canonicalUrl.resolve(item.href)}
                ref={(node) => {
                  tileRefs.current[index] = node;
                }}
                onKeyDown={(event) => handleTileKeyDown(event, index)}
                className="row"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-ega-border bg-ega-surface-subtle text-ega-text-secondary">
                  <Icon className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
                </span>
                <span className="row-main">
                  <span className="row-title">{item.label}</span>
                  <span className="row-meta">{item.description}</span>
                </span>
                <Badge
                  tone={item.available ? "active" : "muted"}
                  className="shrink-0"
                >
                  {item.available ? "Available" : "Unavailable"}
                </Badge>
                <span className="row-actions">
                  <span className="flex h-7 shrink-0 items-center gap-1 rounded-[var(--radius-sm)] border border-ega-border bg-ega-surface px-2.5 text-[length:var(--text-meta)] font-medium text-ega-text">
                    Open
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      </Card>
    </section>
  );
}
