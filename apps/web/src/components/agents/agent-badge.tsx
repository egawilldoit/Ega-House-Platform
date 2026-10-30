import {
  AGENT_KIND_LABELS,
  agentInitials,
  isAgentAvatarColor,
  isAgentKind,
  type AgentAvatarColor,
  type AgentKind,
} from "@/lib/agent-registry";
import { cn } from "@/lib/utils";

const AVATAR_STYLES: Record<AgentAvatarColor, { background: string; color: string }> = {
  blue: { background: "var(--ega-data-blue-soft)", color: "var(--ega-data-blue)" },
  violet: { background: "var(--status-review-bg)", color: "var(--status-review)" },
  green: { background: "var(--ega-data-green-soft)", color: "var(--ega-data-green)" },
  amber: { background: "var(--ega-data-orange-soft)", color: "var(--ega-data-orange)" },
  slate: { background: "var(--ega-data-slate-soft)", color: "var(--ega-data-slate)" },
  rose: { background: "var(--status-overdue-bg)", color: "var(--status-overdue)" },
};

const SIZE_CLASSES = {
  sm: "h-5 w-5 text-[10px]",
  md: "h-7 w-7 text-[length:var(--text-micro)]",
  lg: "h-10 w-10 text-[length:var(--text-meta)]",
} as const;

export type AgentBadgeProps = {
  displayName: string;
  kind?: AgentKind | string | null;
  avatarColor?: AgentAvatarColor | string | null;
  role?: string | null;
  size?: keyof typeof SIZE_CLASSES;
  showKind?: boolean;
  className?: string;
};

/**
 * Presentational agent identity: initials avatar, display name and the
 * owner-declared kind. The kind is a label, not proof of the vendor.
 */
export function AgentBadge({
  displayName,
  kind,
  avatarColor,
  role,
  size = "md",
  showKind = true,
  className,
}: AgentBadgeProps) {
  const resolvedKind: AgentKind = isAgentKind(kind) ? kind : "custom";
  const resolvedColor: AgentAvatarColor = isAgentAvatarColor(avatarColor)
    ? avatarColor
    : "slate";
  const style = AVATAR_STYLES[resolvedColor];
  const label = AGENT_KIND_LABELS[resolvedKind];

  return (
    <span
      className={cn("inline-flex min-w-0 items-center gap-2", className)}
      data-agent-kind={resolvedKind}
    >
      <span
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full border border-[var(--ega-border)] font-semibold",
          SIZE_CLASSES[size],
        )}
        style={style}
        aria-hidden="true"
      >
        {agentInitials(displayName)}
      </span>
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[length:var(--text-body)] font-medium text-[color:var(--ega-text)]">
            {displayName}
          </span>
          {showKind ? (
            <span className="shrink-0 rounded-[var(--radius-pill)] border border-[var(--ega-border)] px-1.5 py-0.5 text-[length:var(--text-micro)] text-[color:var(--ega-text-secondary)]">
              {label}
            </span>
          ) : null}
        </span>
        {role ? (
          <span className="block truncate text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
            {role}
          </span>
        ) : null}
      </span>
    </span>
  );
}
