import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { Bot, History } from "lucide-react";

import { AgentBadge } from "@/components/agents/agent-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { WorkspacePageHeader } from "@/components/layout/workspace-page-header";
import {
  AGENT_AVATAR_COLORS,
  AGENT_KIND_LABELS,
  AGENT_KINDS,
  formatAgentCapabilities,
  type AgentActorDetail,
  type AgentEventSummary,
} from "@/lib/agent-registry";
import { getAgentActor } from "@/lib/services/agent-registry-service";
import { AgentCredentialRow } from "../credential-row";
import { setAgentArchivedAction, updateAgentAction } from "../actions";
import { IssueCredentialForm } from "./issue-credential-form";

export const metadata: Metadata = {
  title: "Agent",
  description: "Agent identity, granted capabilities and recent observed activity.",
};

export const dynamic = "force-dynamic";

const FIELD_CLASS =
  "h-9 w-full rounded-[var(--radius-sm)] border border-[var(--ega-border)] bg-[var(--ega-surface)] px-2 text-[length:var(--text-body)] text-[color:var(--ega-text)]";

function formatDate(value: string | null, fallback: string) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function EventRow({ event }: { event: AgentEventSummary }) {
  const tone =
    event.outcome === "success"
      ? "active"
      : event.outcome === "denied"
        ? "warn"
        : event.outcome === "failure" || event.outcome === "error"
          ? "error"
          : "muted";
  return (
    <li className="flex flex-col gap-1 border-b border-[var(--ega-divider)] px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-[length:var(--text-body)] text-[color:var(--ega-text)]">{event.label}</p>
        <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
          {event.resourceType ?? "No resource"}
          {event.resourceId ? ` · ${event.resourceId}` : ""} ·{" "}
          <time dateTime={event.createdAt}>{formatDate(event.createdAt, "unknown")}</time>
        </p>
      </div>
      <Badge tone={tone}>{event.outcome}</Badge>
    </li>
  );
}

function AgentShell({
  title,
  description,
  children,
  actions,
}: {
  title: string;
  description: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <>
      <WorkspacePageHeader title={title} description={description} actions={actions} />
      {children}
    </>
  );
}

function AgentDetail({ agent }: { agent: AgentActorDetail }) {
  const capabilities = formatAgentCapabilities(agent.capabilities);
  const activeCredentials = agent.credentials.filter((credential) => credential.revokedAt === null);
  const archived = agent.archivedAt !== null;

  return (
    <AgentShell
      title={agent.displayName}
      description={`${AGENT_KIND_LABELS[agent.kind]} · owner-declared identity`}
      actions={
        <Link href="/agents" className="btn-instrument btn-instrument-muted">
          All agents
        </Link>
      }
    >
      <div className="flex flex-col gap-4">
        <Card level="hero">
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <AgentBadge displayName={agent.displayName} />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[length:var(--text-panel-title)] font-semibold">{agent.displayName}</h2>
                  <Badge tone={archived ? "muted" : "active"}>{archived ? "Archived" : "Active"}</Badge>
                  <Badge tone="muted">{AGENT_KIND_LABELS[agent.kind]}</Badge>
                </div>
                <p className="mt-1 text-[length:var(--text-body)] text-[color:var(--ega-text-secondary)]">
                  {agent.description || "No description provided."}
                </p>
                <p className="mt-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
                  Created {formatDate(agent.createdAt, "unknown")} · Last updated{" "}
                  {formatDate(agent.updatedAt, "unknown")}
                  {agent.lastUsedAt ? ` · Last used ${formatDate(agent.lastUsedAt, "unknown")}` : ""}
                </p>
                <p className="mt-2 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
                  Capabilities: {capabilities.length > 0 ? capabilities.join(", ") : "None declared"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Profile</CardTitle>
              <CardDescription>Rename, describe or change the agent kind.</CardDescription>
            </CardHeader>
            <CardContent>
              <form action={updateAgentAction} className="flex flex-col gap-3">
                <input type="hidden" name="agentId" value={agent.id} />
                <input type="hidden" name="returnTo" value={`/agents/${agent.id}`} />
                <label className="flex flex-col gap-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
                  Display name
                  <input name="displayName" defaultValue={agent.displayName} className={FIELD_CLASS} required maxLength={80} />
                </label>
                <label className="flex flex-col gap-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
                  Description
                  <textarea name="description" defaultValue={agent.description ?? ""} className="min-h-20 w-full rounded-[var(--radius-sm)] border border-[var(--ega-border)] bg-[var(--ega-surface)] px-2 py-1.5 text-[length:var(--text-body)] text-[color:var(--ega-text)]" maxLength={280} />
                </label>
                <label className="flex flex-col gap-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
                  Kind
                  <select name="kind" defaultValue={agent.kind} className={FIELD_CLASS}>
                    {AGENT_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {AGENT_KIND_LABELS[kind]}
                      </option>
                    ))}
                  </select>
                </label>
                <div>
                  <PendingSubmitButton type="submit" size="sm">
                    Save changes
                  </PendingSubmitButton>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Credentials</CardTitle>
              <CardDescription>Issue scoped credentials or revoke them individually.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <IssueCredentialForm agentId={agent.id} />
              <div className="flex flex-col gap-2">
                {agent.credentials.length === 0 ? (
                  <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
                    No credentials issued yet.
                  </p>
                ) : (
                  agent.credentials.map((credential) => (
                    <AgentCredentialRow key={credential.id} agentId={agent.id} credential={credential} />
                  ))
                )}
              </div>
              <div className="border-t border-[var(--ega-divider)] pt-3">
                <p className="mb-2 text-[length:var(--text-meta)] font-medium">Lifecycle</p>
                <form action={setAgentArchivedAction} className="border-t border-[var(--ega-divider)] pt-3">
                  <input type="hidden" name="agentId" value={agent.id} />
                  <input type="hidden" name="returnTo" value={`/agents/${agent.id}`} />
                  <input type="hidden" name="archived" value={archived ? "false" : "true"} />
                  <p className="mb-2 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
                    {archived
                      ? "Reactivating restores the identity. Previously revoked credentials stay revoked."
                      : "Archiving revokes every active credential of this agent and keeps its activity history."}
                  </p>
                  <PendingSubmitButton
                    type="submit"
                    variant={archived ? "secondary" : "danger"}
                    size="sm"
                    pendingLabel={archived ? "Reactivating…" : "Archiving…"}
                  >
                    {archived ? "Reactivate agent" : "Archive agent and revoke credentials"}
                  </PendingSubmitButton>
                </form>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="h-4 w-4" />
              Recent activity
            </CardTitle>
            <CardDescription>Latest observed actions for this agent.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {agent.recentEvents.length === 0 ? (
              <div className="px-4 py-6">
                <EmptyState
                  icon={Bot}
                  title="No activity yet"
                  description="Activity appears after the agent uses a credential."
                />
              </div>
            ) : (
              <ul className="divide-y divide-[var(--ega-divider)]">
                {agent.recentEvents.map((event) => (
                  <EventRow key={event.id} event={event} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </AgentShell>
  );
}

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getAgentActor(id);

  if (result.kind === "unavailable") {
    return (
      <AgentShell title="Agent" description="Agent identity and activity.">
        <Card>
          <EmptyState
            icon={Bot}
            title="Agent not found"
            description="This agent does not exist for the signed-in owner."
          />
        </Card>
      </AgentShell>
    );
  }

  if (result.kind === "error") {
    return (
      <AgentShell title="Agent" description="Agent identity and activity.">
        <Card>
          <EmptyState
            icon={Bot}
            title="Unable to load this agent"
            description={result.errorMessage}
          />
        </Card>
      </AgentShell>
    );
  }

  return <AgentDetail agent={result.agent} />;
}
