import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import {
  AGENT_AVATAR_COLORS,
  AGENT_KIND_LABELS,
  AGENT_KINDS,
} from "@/lib/agent-registry";
import { createAgentAction } from "./actions";

const FIELD_CLASS =
  "h-9 w-full rounded-[var(--radius-sm)] border border-[var(--ega-border)] bg-[var(--ega-surface)] px-2 text-[length:var(--text-body)] text-[color:var(--ega-text)]";

export function AgentCreateForm() {
  return (
    <details className="group rounded-[var(--radius-lg)] border border-[var(--ega-border)] bg-[color:var(--ega-surface)]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-[length:var(--text-body)] font-medium text-[color:var(--ega-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ega-accent)]">
        Register an agent
        <span className="text-[length:var(--text-meta)] font-normal text-[color:var(--ega-text-tertiary)] group-open:hidden">
          Identity only — credentials are issued separately
        </span>
      </summary>
      <form action={createAgentAction} className="grid gap-3 border-t border-[var(--ega-divider)] px-4 py-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="agent-display-name" className="text-[length:var(--text-meta)] font-medium">
            Display name
          </label>
          <input
            id="agent-display-name"
            name="displayName"
            required
            maxLength={80}
            autoComplete="off"
            className={FIELD_CLASS}
            placeholder="e.g. Codex"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="agent-kind" className="text-[length:var(--text-meta)] font-medium">
            Kind
          </label>
          <select id="agent-kind" name="kind" className={FIELD_CLASS} defaultValue="custom">
            {AGENT_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {AGENT_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="agent-role" className="text-[length:var(--text-meta)] font-medium">
            Display role <span className="font-normal text-[color:var(--ega-text-tertiary)]">(optional)</span>
          </label>
          <input
            id="agent-role"
            name="role"
            maxLength={64}
            autoComplete="off"
            className={FIELD_CLASS}
            placeholder="e.g. Implementation"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="agent-color" className="text-[length:var(--text-meta)] font-medium">
            Avatar colour
          </label>
          <select id="agent-color" name="avatarColor" className={FIELD_CLASS} defaultValue="slate">
            {AGENT_AVATAR_COLORS.map((color) => (
              <option key={color} value={color}>
                {color.charAt(0).toUpperCase() + color.slice(1)}
              </option>
            ))}
          </select>
        </div>
        <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)] sm:col-span-2">
          Kind and role are owner-declared labels shown in the UI. They do not grant access;
          capabilities come only from active credentials.
        </p>
        <div className="sm:col-span-2">
          <PendingSubmitButton type="submit" variant="primary" size="sm" pendingLabel="Registering…">
            Register agent
          </PendingSubmitButton>
        </div>
      </form>
    </details>
  );
}
