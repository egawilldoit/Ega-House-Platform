import {
  ArrowDown,
  ArrowRight,
  Bot,
  Database,
  Eye,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";

const trustItems = [
  { label: "OAuth protected", icon: LockKeyhole },
  { label: "Scoped to your account", icon: UserRound },
  { label: "Read-only first release", icon: Eye },
] as const;

function FlowConnector({ animated = false }: { animated?: boolean }) {
  return (
    <div className="mcp-flow-connector" aria-hidden="true">
      <span className="mcp-connector-line" />
      {animated ? <span className="mcp-connector-signal" /> : null}
      <ArrowRight className="mcp-connector-arrow mcp-connector-arrow-horizontal" />
      <ArrowDown className="mcp-connector-arrow mcp-connector-arrow-vertical" />
    </div>
  );
}

export function McpComingSoonAnnouncement() {
  return (
    <aside
      aria-labelledby="mcp-coming-soon-title"
      className="mcp-launch-console p-5 sm:p-7 lg:p-8"
    >
      <div className="relative z-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Badge tone="active" className="gap-1.5">
            <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
            NEW IN EGA HOUSE
          </Badge>
          <StatusBadge status="todo" label="Coming soon" />
        </div>

        <div className="mt-6 max-w-4xl">
          <h2
            id="mcp-coming-soon-title"
            className="font-display text-3xl font-semibold leading-[1.05] tracking-[-0.045em] text-[color:var(--foreground)] sm:text-4xl lg:text-[2.75rem]"
          >
            Your workspace is about to become AI-connected.
          </h2>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-[color:var(--muted-foreground)] sm:text-[0.98rem]">
            Approved AI tools will soon be able to read your projects, goals, and tasks
            directly. Nothing changes until you choose to connect one.
          </p>
        </div>

        <div className="mcp-flow-stage mt-7">
          <div
            className="mcp-connection-flow"
            role="img"
            aria-label="Approved AI tools connect through a secure gateway to read projects, goals, and tasks."
          >
            <div className="mcp-flow-node">
              <span className="mcp-flow-node-icon" aria-hidden="true">
                <Bot className="h-5 w-5" />
              </span>
              <span>AI clients</span>
            </div>

            <FlowConnector animated />

            <div className="mcp-flow-node mcp-flow-node-gateway">
              <span className="mcp-gateway-glow" aria-hidden="true" />
              <span className="mcp-flow-node-icon mcp-flow-node-icon-gateway" aria-hidden="true">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <span>Secure gateway</span>
            </div>

            <FlowConnector />

            <div className="mcp-flow-node">
              <span className="mcp-flow-node-icon" aria-hidden="true">
                <Database className="h-5 w-5" />
              </span>
              <span>Projects · Goals · Tasks</span>
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2" aria-label="Connection safeguards">
          {trustItems.map(({ label, icon: Icon }) => (
            <Badge key={label} tone="muted" className="mcp-trust-chip">
              <Icon aria-hidden="true" className="h-3.5 w-3.5 text-[color:var(--signal-live)]" />
              {label}
            </Badge>
          ))}
        </div>
      </div>
    </aside>
  );
}
