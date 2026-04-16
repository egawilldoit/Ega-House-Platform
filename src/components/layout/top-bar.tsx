import { Search, Bell, Settings } from "lucide-react";

export function TopBar() {
  return (
    <header className="ega-topbar flex items-center justify-between px-8">
      {/* Search */}
      <div className="flex items-center gap-4 flex-1 max-w-xl">
        <Search className="size-3.5 text-etch flex-shrink-0" strokeWidth={1.5} />
        <input
          type="text"
          placeholder="Search command…"
          className="bg-transparent border-none text-sm text-foreground placeholder:text-etch focus:outline-none focus:ring-0 flex-1 w-full"
          style={{ color: "var(--foreground)" }}
        />
        <kbd className="glass-label text-etch border border-[var(--border)] px-2 py-1 rounded-sm flex-shrink-0">
          ⌘K
        </kbd>
      </div>

      {/* Status cluster */}
      <div className="flex items-center gap-6">
        {/* Live indicator */}
        <div className="flex items-center gap-2">
          <div className="size-2 rounded-full bg-signal-live signal-dot-live flex-shrink-0" />
          <span className="glass-label text-muted-foreground">Live</span>
        </div>

        <div className="h-4 w-px" style={{ background: "var(--border)" }} />

        <button
          className="transition-precise text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          aria-label="Notifications"
        >
          <Bell className="size-4" strokeWidth={1.5} />
        </button>

        <button
          className="transition-precise text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          aria-label="Settings"
        >
          <Settings className="size-4" strokeWidth={1.5} />
        </button>

        {/* Avatar */}
        <div
          className="size-8 rounded-full border flex items-center justify-center flex-shrink-0"
          style={{ background: "var(--instrument)", borderColor: "var(--border)" }}
        >
          <span className="glass-label" style={{ color: "var(--foreground)" }}>EG</span>
        </div>
      </div>
    </header>
  );
}
