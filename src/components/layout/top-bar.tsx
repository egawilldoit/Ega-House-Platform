import React from "react";
import Link from "next/link";
import { Search, Bell, Mail } from "lucide-react";
import type { WorkspaceShellMetrics } from "@/lib/workspace-shell";

import { TopBarSignalCluster } from "./shell-signals";

export function TopBar({ metrics }: { metrics: WorkspaceShellMetrics }) {
  return (
    <header className="ega-topbar px-8 py-5">
      <div className="ega-shell-max flex items-center justify-between gap-6">
        <div className="shell-search flex-1 max-w-md">
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

        <div className="flex items-center gap-3">
          <TopBarSignalCluster metrics={metrics} />

          <Link
            href="/apps"
            className="dashboard-upgrade-pill"
          >
            Apps
          </Link>

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

          <div className="dashboard-topbar-avatar" aria-label="User profile">
            EG
          </div>
        </div>
      </div>
    </header>
  );
}
