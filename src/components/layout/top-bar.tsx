import { Search, Bell, Mail } from "lucide-react";

export function TopBar() {
  return (
    <header className="ega-topbar flex items-center justify-between px-6">
      {/* Search */}
      <div className="shell-search flex-1 max-w-md">
        <Search className="size-4 text-etch flex-shrink-0" strokeWidth={1.5} />
        <input
          type="text"
          placeholder="Search task"
          className="bg-transparent border-none text-sm text-foreground placeholder:text-etch focus:outline-none focus:ring-0 flex-1 w-full"
          style={{ color: "var(--foreground)" }}
        />
        <kbd className="glass-label text-etch rounded-md border border-[var(--border)] bg-white px-2 py-0.5 flex-shrink-0 text-[10px]">
          ⌘ F
        </kbd>
      </div>

      {/* Right cluster */}
      <div className="flex items-center gap-4">
        <button
          className="transition-precise relative text-[var(--muted-foreground)] hover:text-[var(--foreground)] p-2 rounded-lg hover:bg-[var(--secondary)]"
          aria-label="Messages"
        >
          <Mail className="size-[18px]" strokeWidth={1.5} />
        </button>

        <button
          className="transition-precise relative text-[var(--muted-foreground)] hover:text-[var(--foreground)] p-2 rounded-lg hover:bg-[var(--secondary)]"
          aria-label="Notifications"
        >
          <Bell className="size-[18px]" strokeWidth={1.5} />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[var(--signal-error)]" />
        </button>

        {/* Avatar + Name */}
        <div className="flex items-center gap-3 pl-2 border-l border-[var(--border)]">
          <div
            className="size-9 rounded-full border-2 flex items-center justify-center flex-shrink-0 overflow-hidden"
            style={{ borderColor: "var(--accent)", background: "var(--accent-light)" }}
          >
            <span className="text-xs font-bold" style={{ color: "var(--accent)" }}>EG</span>
          </div>
          <div className="hidden sm:block">
            <div className="text-sm font-semibold text-[color:var(--foreground)] leading-tight">EGA User</div>
            <div className="text-[11px] text-[color:var(--muted-foreground)] leading-tight">user@egahouse.com</div>
          </div>
        </div>
      </div>
    </header>
  );
}
