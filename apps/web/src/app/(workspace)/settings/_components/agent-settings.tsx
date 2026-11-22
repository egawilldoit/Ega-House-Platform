import { Bot } from "lucide-react";

import { AgentBadge } from "@/components/agents/agent-badge";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import {
  formatAgentCapabilities,
  type AgentActorSummary,
} from "@/lib/agent-registry";
import type { AgentRegistryList } from "@/lib/services/agent-registry-service";
import { setAgentArchivedAction } from "@/app/(workspace)/settings/_actions/agent-actions";

import { AgentCreateForm } from "./agent-create-form";
import { AgentCredentialRow } from "./agent-credential-row";

function formatObserved(value: string | null) {
  if (!value) return "No activity observed";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No activity observed";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function AgentRow({ actor }: { actor: AgentActorSummary }) {
  const capabilities = formatAgentCapabilities(actor.capabilities);
  const activeCredentials = actor.credentials.filter((credential) => credential.revokedAt === null);
  const archived = actor.archivedAt !== null;

  return (
    <li className="border-b border-[var(--ega-divider)] last:border-b-0">
      <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <AgentBadge
            displayName={actor.displayName}
            kind={actor.kind}
            avatarColor={actor.avatarColor}
            role={actor.role}
            size="lg"
            className="items-start"
          />
        </div>
        <div className="min-w-0 flex-1 sm:max-w-[52%]">
          <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            {capabilities.join(" · ")}
          </p>
          <p className="mt-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
            {activeCredentials.length} active credential
            {activeCredentials.length === 1 ? "" : "s"} ·{" "}
            {actor.lastObservedAt
              ? `${actor.lastObservedLabel ?? "Observed"} · ${formatObserved(actor.lastObservedAt)}`
              : "No activity observed"}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Badge tone={archived ? "muted" : "active"}>{archived ? "Archived" : "Active"}</Badge>
          <form action={setAgentArchivedAction}>
            <input type="hidden" name="agentId" value={actor.id} />
            <input type="hidden" name="archived" value={archived ? "false" : "true"} />
            <PendingSubmitButton
              type="submit"
              variant={archived ? "secondary" : "danger"}
              size="sm"
              pendingLabel={archived ? "Reactivating…" : "Archiving…"}
            >
              {archived ? "Reactivate" : "Archive"}
            </PendingSubmitButton>
          </form>
        </div>
      </div>
      {actor.credentials.length > 0 ? (
        <details className="border-t border-[var(--ega-divider)]">
          <summary className="cursor-pointer list-none px-4 py-2 text-[length:var(--text-meta)] font-medium text-[color:var(--ega-text-secondary)]">
            Credentials ({actor.credentials.length})
          </summary>
          <ul className="border-t border-[var(--ega-divider)]">
            {actor.credentials.map((credential) => (
              <AgentCredentialRow key={credential.id} credential={credential} />
            ))}
          </ul>
        </details>
      ) : null}
    </li>
  );
}

/**
 * Integrations → agents. Credentials are the security-relevant surface: revoke
 * one without affecting the agent's other credentials; archiving the identity
 * revokes every active credential.
 */
export function AgentSettings({ registry }: { registry: AgentRegistryList }) {
  return (
    <section aria-labelledby="agents-heading" className="flex flex-col gap-4">
      <Card clip level="standard">
        <CardHeader>
          <CardTitle id="agents-heading">Agents and MCP/OAuth credentials</CardTitle>
          <CardDescription>
            Identity is separate from credentials. Revoking one credential does not
            revoke the others; archiving an agent revokes all of its active credentials.
          </CardDescription>
        </CardHeader>
        {registry.errorMessage ? (
          <p role="alert" className="px-4 py-3 text-[length:var(--text-meta)] text-[color:var(--status-overdue)]">
            {registry.errorMessage}
          </p>
        ) : null}
        {registry.actors.length === 0 ? (
          <EmptyState
            icon={Bot}
            title="No agents registered yet"
            description="Register an identity to label agent activity. Agent names are owner-declared labels, not verified vendor identities."
          />
        ) : (
          <ul>
            {registry.actors.map((actor) => (
              <AgentRow key={actor.id} actor={actor} />
            ))}
          </ul>
        )}
      </Card>

      <AgentCreateForm />

      {registry.unassignedCredentials.length > 0 ? (
        <Card clip level="compact">
          <CardHeader>
            <CardTitle>Unassigned credentials</CardTitle>
            <CardDescription>
              These credentials were issued before an identity was linked. They are not
              shown as agents and can be revoked here.
            </CardDescription>
          </CardHeader>
          <ul>
            {registry.unassignedCredentials.map((credential) => (
              <AgentCredentialRow key={credential.id} credential={credential} />
            ))}
          </ul>
        </Card>
      ) : null}
    </section>
  );
}
