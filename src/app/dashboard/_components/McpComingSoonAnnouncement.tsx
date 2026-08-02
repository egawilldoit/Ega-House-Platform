import {
  Bot,
  Cable,
  Eye,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

const capabilityItems = [
  { label: "Owner-scoped access", icon: ShieldCheck },
  { label: "Read-only at launch", icon: Eye },
  { label: "Built for MCP clients", icon: Cable },
] as const;

export function McpComingSoonAnnouncement() {
  return (
    <aside
      aria-labelledby="mcp-coming-soon-title"
      className="relative isolate overflow-hidden rounded-[calc(var(--radius-card)+0.25rem)] border border-white/15 bg-[linear-gradient(135deg,#0f241c_0%,#173b2d_48%,#177b52_120%)] p-5 text-white shadow-[var(--shadow-card)] sm:p-6"
    >
      <div
        aria-hidden="true"
        className="absolute -right-16 -top-20 -z-10 h-56 w-56 rounded-full bg-white/10 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="absolute bottom-0 right-0 -z-10 h-24 w-40 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.18)_1px,transparent_1px)] bg-[length:12px_12px] opacity-50"
      />

      <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[0.68rem] font-semibold tracking-[0.16em] text-emerald-50">
            <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
            MCP · COMING SOON
          </div>

          <h2
            id="mcp-coming-soon-title"
            className="mt-4 font-display text-2xl font-semibold tracking-[-0.04em] text-white sm:text-3xl"
          >
            Connect your AI to EGA House.
          </h2>

          <p className="mt-3 max-w-3xl text-sm leading-7 text-white/75 sm:text-[0.95rem]">
            Soon, approved AI clients will be able to securely read your projects,
            goals, and tasks through an OAuth-protected EGA House connection.
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            {capabilityItems.map(({ label, icon: Icon }) => (
              <span
                key={label}
                className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/10 px-3 py-2 text-xs font-medium text-white/90"
              >
                <Icon aria-hidden="true" className="h-3.5 w-3.5 text-emerald-200" />
                {label}
              </span>
            ))}
          </div>

          <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-white/60">
            <LockKeyhole aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Your workspace stays private. Access is granted per user and per approved client.
          </p>
        </div>

        <div
          aria-hidden="true"
          className="hidden h-28 w-28 place-items-center rounded-[1.75rem] border border-white/15 bg-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] lg:grid"
        >
          <div className="relative grid h-16 w-16 place-items-center rounded-2xl border border-emerald-200/25 bg-emerald-200/10">
            <Bot className="h-8 w-8 text-emerald-100" />
            <span className="absolute -right-2 -top-2 grid h-7 w-7 place-items-center rounded-full border border-white/20 bg-[#177b52]">
              <Cable className="h-3.5 w-3.5 text-white" />
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}
