"use client";

import React from "react";
import Link from "next/link";
import { Search, Bell, Keyboard, Mail } from "lucide-react";
import type { WorkspaceShellMetrics } from "@/lib/workspace-shell";

import { TopBarSignalCluster } from "./shell-signals";
import { workspaceShortcutEvents } from "./workspace-keyboard-shortcuts";

export function TopBar({ metrics }: { metrics: WorkspaceShellMetrics }) {
  return (
    <header className="ega-topbar">
      <div className="ega-shell-max ega-topbar-row">
        <div className="shell-search">
          <Search className="size-4 text-etch flex-shrink-0" strokeWidth={1.5} />
          <input
            type="search"
            placeholder="Search tasks, goals, projects..."
            className="bg-transparent border-none text-sm text-foreground placeholder:text-etch focus:outline-none focus:ring-0 flex-1 w-full"
            style={{ color: "var(--foreground)" }}
          />
          <kbd className="glass-label text-etch rounded-md border border-[var(--border)] bg-white px-2 py-0.5 flex-shrink-0 text-[10px]">
            Ctrl K
          </kbd>
        </div>

        <div className="topbar-actions">
          <TopBarSignalCluster metrics={metrics} />

          <Link
            href="/apps"
            className="dashboard-upgrade-pill"
          >
            Apps
          </Link>

          <button
            type="button"
            className="hidden items-center gap-2 rounded-full border border-[var(--border)] bg-white/80 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted-foreground)] transition-precise hover:bg-[var(--secondary)] hover:text-[var(--foreground)] lg:inline-flex"
            aria-label="Open keyboard shortcuts"
            onClick={() => window.dispatchEvent(new CustomEvent(workspaceShortcutEvents.openHelp))}
          >
            <Keyboard className="size-3.5" strokeWidth={1.8} />
            Shortcuts
            <kbd className="rounded border border-[var(--border)] bg-white px-1.5 py-0.5 text-[10px] font-semibold text-etch">
              ?
            </kbd>
          </button>

          <button
            className="transition-precise relative rounded-full p-2 text-[var(--muted-foreground)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
            aria-label="Messages"
          >
            <Mail className="size-[18px]" strokeWidth={1.5} />
          </button>

          <button
            className="transition-precise relative rounded-full p-2 text-[var(--muted-foreground)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
            aria-label="Notifications"
          >
            <Bell className="size-[18px]" strokeWidth={1.5} />
            <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[var(--signal-error)]" />
          </button>

          <div className="dashboard-topbar-avatar" aria-label="User profile" suppressHydrationWarning>
            EG
          </div>
        </div>
      </div>
    </header>
  );
}
