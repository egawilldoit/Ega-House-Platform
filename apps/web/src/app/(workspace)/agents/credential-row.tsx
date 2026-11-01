import { Badge } from "@/components/ui/badge";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import {
  formatAgentCapabilities,
  mergeAgentCapabilities,
  type AgentCredentialSummary,
} from "@/lib/agent-registry";
import { revokeCredentialAction } from "./actions";

function formatDate(value: string | null, fallback: string) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function AgentCredentialRow({
  credential,
  returnTo,
}: {
  credential: AgentCredentialSummary;
  returnTo: string;
}) {
  const revoked = credential.revokedAt !== null;
  const summary = formatAgentCapabilities(mergeAgentCapabilities([credential.scopes])).join(" · ");

  return (
    <li className="flex flex-col gap-2 border-b border-[var(--ega-divider)] px-4 py-3 last:border-b-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[length:var(--text-body)] font-medium text-[color:var(--ega-text)]">
            {credential.name}
          </span>
          <Badge tone={revoked ? "muted" : "active"}>{revoked ? "Revoked" : "Active"}</Badge>
        </div>
        <p className="mt-0.5 break-all font-mono text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
          ega_live_{credential.tokenPrefix}_…
        </p>
        <p className="mt-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
          {summary}
        </p>
        <p className="mt-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
          Created {formatDate(credential.createdAt, "unknown")} · Last used{" "}
          {formatDate(credential.lastUsedAt, "never")}
          {revoked ? ` · Revoked ${formatDate(credential.revokedAt, "unknown")}` : ""}
        </p>
      </div>
      {revoked ? null : (
        <form action={revokeCredentialAction} className="shrink-0">
          <input type="hidden" name="credentialId" value={credential.id} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <PendingSubmitButton
            type="submit"
            variant="danger"
            size="sm"
            pendingLabel="Revoking…"
            aria-label={`Revoke credential ${credential.name}`}
          >
            Revoke
          </PendingSubmitButton>
        </form>
      )}
    </li>
  );
}
