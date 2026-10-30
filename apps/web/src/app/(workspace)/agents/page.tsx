import type { Metadata } from "next";
import Link from "next/link";
import { Bot } from "lucide-react";

import { AgentBadge } from "@/components/agents/agent-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  formatAgentCapabilities,
  type AgentActorSummary,
} from "@/lib/agent-registry";
import { listAgentRegistry } from "@/lib/services/agent-registry-service";
import { AgentCreateForm } from "./agent-create-form";
import { AgentCredentialRow } from "./credential-row";

export const metadata: Metadata = {
  title: "Agents",
  description: "Registered agent identities, their capabilities and observed activity.",
};

export const dynamic = "force-dynamic";

function formatObserved(value: string | null) {
  if (!value) return "No activity observed";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No activity observed";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function AgentRow({ actor }: { actor: AgentActorSummary }) {
  const capabilities = formatAgentCapabilities(actor.capabilities);
  const activeCredentials = actor.credentials.filter((credential) => credential.revokedAt === null);

  return (
    <li className="border-b border-[var(--ega-divider)] last:border-b-0">
      <Link
        href={`/agents/${actor.id}`}
        className="flex flex-col gap-3 px-4 py-4 hover:bg-[var(--ega-surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--ega-accent)] sm:flex-row sm:items-start sm:justify-between"
      >
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
              ? `${actor.lastObservedLabel} · ${formatObserved(actor.lastObservedAt)}`
              : "No activity observed"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {actor.archivedAt ? <Badge tone="muted">Archived</Badge> : null}
          <span className="text-[length:var(--text-meta)] font-medium text-[color:var(--ega-text-secondary)]">
            View agent
          </span>
        </div>
      </Link>
    </li>
  );
}

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const [{ actors, unassignedCredentials, errorMessage }, params] = await Promise.all([
    listAgentRegistry(),
    searchParams,
  ]);

  return (
    <AppShell
      title="Agents"
      description="Owner-registered agent identities, their credentials and observed activity."
    >
      <div className="flex flex-col gap-4">
        {params.error ? (
          <p
            role="alert"
            className="rounded-[var(--radius-md)] border border-[var(--status-overdue-border)] bg-[var(--status-overdue-bg)] px-3 py-2 text-[length:var(--text-meta)] text-[color:var(--status-overdue)]"
          >
            {params.error}
          </p>
        ) : null}
        {params.notice ? (
          <p
            role="status"
            className="rounded-[var(--radius-md)] border border-[var(--status-healthy-border)] bg-[var(--status-healthy-bg)] px-3 py-2 text-[length:var(--text-meta)] text-[color:var(--status-healthy)]"
          >
            {params.notice}
          </p>
        ) : null}
        {errorMessage ? (
          <p
            role="alert"
            className="rounded-[var(--radius-md)] border border-[var(--status-overdue-border)] bg-[var(--status-overdue-bg)] px-3 py-2 text-[length:var(--text-meta)] text-[color:var(--status-overdue)]"
          >
            {errorMessage}
          </p>
        ) : null}

        <Card clip level="standard">
          <CardHeader>
            <CardTitle>Registered agents</CardTitle>
            <CardDescription>
              Identity is separate from credentials. Revoking one credential does not revoke the
              others; archiving an agent revokes all of its active credentials.
            </CardDescription>
          </CardHeader>
          {actors.length === 0 ? (
            <EmptyState
              icon={Bot}
              title="No agents registered yet"
              description="Register an identity first, then issue it a revocable credential. Agent names are owner-declared labels, not verified vendor identities."
            />
          ) : (
            <ul>
              {actors.map((actor) => (
                <AgentRow key={actor.id} actor={actor} />
              ))}
            </ul>
          )}
        </Card>

        <AgentCreateForm />

        {unassignedCredentials.length > 0 ? (
          <Card clip level="compact">
            <CardHeader>
              <CardTitle>Unassigned credentials</CardTitle>
              <CardDescription>
                These credentials were issued before an identity was linked. They are not shown as
                agents and can be revoked here.
              </CardDescription>
            </CardHeader>
            <ul>
              {unassignedCredentials.map((credential) => (
                <AgentCredentialRow
                  key={credential.id}
                  credential={credential}
                  returnTo="/agents"
                />
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </AppShell>
  );
}
