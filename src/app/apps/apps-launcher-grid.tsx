"use client";

import type { KeyboardEvent } from "react";
import { useRef } from "react";
import Link from "next/link";
import { LayoutDashboard, Target, Timer, ListChecks, NotebookTabs } from "lucide-react";

import type { AppsLauncherIconKey, AppsLauncherItem } from "./launcher-items";
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

function getGridColumnCount() {
  if (typeof window === "undefined") {
    return 2;
  }
  return window.matchMedia("(min-width: 768px)").matches ? 2 : 1;
}

export function AppsLauncherGrid({ items }: AppsLauncherGridProps) {
  const tileRefs = useRef<Array<HTMLAnchorElement | null>>([]);

  const handleTileKeyDown = (event: KeyboardEvent<HTMLAnchorElement>, index: number) => {
    const nextIndex = getNextLauncherIndex({
      currentIndex: index,
      key: event.key,
      totalItems: items.length,
      columns: getGridColumnCount(),
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
    <section
      aria-label="Apps launcher"
      className="grid gap-4 sm:grid-cols-2"
    >
      {items.map((item, index) => {
        const Icon = ICON_MAP[item.icon];
        return (
          <Link
            key={item.id}
            href={item.href}
            ref={(node) => {
              tileRefs.current[index] = node;
            }}
            onKeyDown={(event) => handleTileKeyDown(event, index)}
            className="group rounded-[1.05rem] border border-[var(--border)] bg-white p-5 transition-precise hover:border-[var(--accent-soft)] hover:bg-[color:var(--instrument)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5 rounded-lg border border-[var(--border)] bg-[color:var(--instrument-raised)] p-2 text-[color:var(--muted-foreground)] transition-precise group-hover:text-[color:var(--foreground)] group-focus-visible:text-[color:var(--foreground)]">
                <Icon className="size-4" strokeWidth={1.7} aria-hidden="true" />
              </span>
              <span className="flex-1">
                <span className="block text-sm font-semibold text-[color:var(--foreground)]">
                  {item.label}
                </span>
                <span className="mt-1 block text-sm leading-6 text-[color:var(--muted-foreground)]">
                  {item.description}
                </span>
              </span>
            </div>
          </Link>
        );
      })}
    </section>
  );
}
