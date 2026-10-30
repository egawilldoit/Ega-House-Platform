import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { Bot, History } from "lucide-react";

import { AgentBadge } from "@/components/agents/agent-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
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
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <AppShell
      title={title}
      description={description}
      actions={
        <Link
          href="/agents"
          className="btn-instrument btn-instrument-muted flex h-8 items-center px-3 text-sm"
        >
          All agents
        </Link>
      }
    >
      {children}
    </AppShell>
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
    >
      <div className="flex flex-col gap-4">
        <Card level="hero">
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <AgentBadge
                displayName={agent.displayName}
                kind={agent.kind}
                avatarColor={agent.avatarColor}
                role={agent.role}
                size="lg"
                className="items-start"
              />
              <div className="min-w-0">
                <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
                  {capabilities.join(" · ")}
                </p>
                <p className="mt-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
                  {agent.lastObservedAt
                    ? `Last observed: ${agent.lastObservedLabel} · ${formatDate(agent.lastObservedAt, "unknown")}`
                    : "No observed activity yet."}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Badge tone={archived ? "muted" : "active"}>{archived ? "Archived" : "Active"}</Badge>
              <Badge tone="muted">
                {activeCredentials.length} active credential
                {activeCredentials.length === 1 ? "" : "s"}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card clip level="standard">
          <CardHeader>
            <CardTitle>Credentials</CardTitle>
            <CardDescription>
              Capabilities come only from these credentials. Revoking one credential leaves the
              agent&apos;s other credentials unchanged.
            </CardDescription>
          </CardHeader>
          {agent.credentials.length === 0 ? (
            <EmptyState
              icon={Bot}
              title="No credentials yet"
              description="Issue a credential to let this agent authenticate. The raw token is shown once."
            />
          ) : (
            <ul>
              {agent.credentials.map((credential) => (
                <AgentCredentialRow
                  key={credential.id}
                  credential={credential}
                  returnTo={`/agents/${agent.id}`}
                />
              ))}
            </ul>
          )}
          <div className="border-t border-[var(--ega-divider)] px-4 py-4">
            <h3 className="mb-3 text-[length:var(--text-panel-title)] font-semibold text-[color:var(--ega-text)]">
              Issue a credential
            </h3>
            <IssueCredentialForm agentId={agent.id} disabled={archived} />
            {archived ? (
              <p className="mt-2 text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
                Reactivate this agent before issuing another credential.
              </p>
            ) : null}
          </div>
        </Card>

        <Card clip level="standard">
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>
              Durable events recorded for this identity. Revoking a credential does not remove them.
            </CardDescription>
          </CardHeader>
          {agent.events.length === 0 ? (
            <EmptyState
              icon={History}
              title="No activity observed yet"
              description="Agent events appear here after a credential performs an action through the agent API."
            />
          ) : (
            <ul>
              {agent.events.map((event) => (
                <EventRow key={event.id} event={event} />
              ))}
            </ul>
          )}
        </Card>

        <Card level="standard">
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>
              Display role and kind are presentation only; they never grant capabilities.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <form action={updateAgentAction} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="agentId" value={agent.id} />
              <input type="hidden" name="returnTo" value={`/agents/${agent.id}`} />
              <div className="flex flex-col gap-1">
                <label htmlFor="edit-agent-name" className="text-[length:var(--text-meta)] font-medium">
                  Display name
                </label>
                <input
                  id="edit-agent-name"
                  name="displayName"
                  required
                  maxLength={80}
                  defaultValue={agent.displayName}
                  className={FIELD_CLASS}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="edit-agent-kind" className="text-[length:var(--text-meta)] font-medium">
                  Kind
                </label>
                <select
                  id="edit-agent-kind"
                  name="kind"
                  defaultValue={agent.kind}
                  className={FIELD_CLASS}
                >
                  {AGENT_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {AGENT_KIND_LABELS[kind]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="edit-agent-role" className="text-[length:var(--text-meta)] font-medium">
                  Display role
                </label>
                <input
                  id="edit-agent-role"
                  name="role"
                  maxLength={64}
                  defaultValue={agent.role ?? ""}
                  className={FIELD_CLASS}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="edit-agent-color" className="text-[length:var(--text-meta)] font-medium">
                  Avatar colour
                </label>
                <select
                  id="edit-agent-color"
                  name="avatarColor"
                  defaultValue={agent.avatarColor}
                  className={FIELD_CLASS}
                >
                  {AGENT_AVATAR_COLORS.map((color) => (
                    <option key={color} value={color}>
                      {color.charAt(0).toUpperCase() + color.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <PendingSubmitButton type="submit" variant="secondary" size="sm" pendingLabel="Saving…">
                  Save profile
                </PendingSubmitButton>
              </div>
            </form>

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
