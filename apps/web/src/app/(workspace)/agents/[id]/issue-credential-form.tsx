"use client";

import { useActionState, useState } from "react";

import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import {
  INITIAL_ISSUE_CREDENTIAL_STATE,
  type IssueCredentialState,
} from "@/lib/agent-credential-issue-state";
import { issueCredentialAction } from "../actions";

const FIELD_CLASS =
  "h-9 w-full rounded-[var(--radius-sm)] border border-[var(--ega-border)] bg-[var(--ega-surface)] px-2 text-[length:var(--text-body)] text-[color:var(--ega-text)]";

const SCOPES = [
  { name: "tasks.read", label: "Read tasks" },
  { name: "tasks.create", label: "Create tasks" },
  { name: "tasks.updateAny", label: "Update any task" },
  { name: "tasks.archive", label: "Archive tasks" },
  { name: "tasks.bulk", label: "Bulk operations" },
  { name: "tasks.comment", label: "Post comments" },
  { name: "projects.read", label: "Read projects" },
  { name: "goals.read", label: "Read goals" },
] as const;

export function IssueCredentialForm({
  agentId,
  disabled,
}: {
  agentId: string;
  disabled: boolean;
}) {
  const [state, formAction] = useActionState<IssueCredentialState, FormData>(
    issueCredentialAction,
    INITIAL_ISSUE_CREDENTIAL_STATE,
  );
  const [copied, setCopied] = useState(false);

  async function copyToken() {
    if (!state.token) return;
    try {
      await navigator.clipboard.writeText(state.token);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <form action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="agentId" value={agentId} />
        <div className="flex flex-col gap-1">
          <label htmlFor="credential-name" className="text-[length:var(--text-meta)] font-medium">
            Credential name
          </label>
          <input
            id="credential-name"
            name="name"
            required
            maxLength={120}
            autoComplete="off"
            className={FIELD_CLASS}
            placeholder="e.g. Local T3 workspace"
          />
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-[length:var(--text-meta)] font-medium">Capabilities</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {SCOPES.map((scope) => (
              <label
                key={scope.name}
                className="flex items-center gap-2 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]"
              >
                <input type="checkbox" name={scope.name} className="h-4 w-4" />
                {scope.label}
              </label>
            ))}
          </div>
        </fieldset>
        {state.status === "error" && state.errorMessage ? (
          <p role="alert" className="text-[length:var(--text-meta)] text-[color:var(--status-overdue)]">
            {state.errorMessage}
          </p>
        ) : null}
        <div>
          <PendingSubmitButton
            type="submit"
            variant="primary"
            size="sm"
            pendingLabel="Issuing…"
            disabled={disabled}
          >
            Issue credential
          </PendingSubmitButton>
        </div>
      </form>

      {state.status === "success" && state.token ? (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--status-risk-border)] bg-[var(--status-risk-bg)] p-3"
        >
          <p className="text-[length:var(--text-meta)] font-medium text-[color:var(--status-risk)]">
            Copy this token now. It is shown once and cannot be retrieved.
          </p>
          <code className="block max-h-32 overflow-auto break-all rounded-[var(--radius-sm)] bg-[var(--ega-surface)] p-2 text-[length:var(--text-meta)]">
            {state.token}
          </code>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={copyToken}
              className="btn-instrument btn-instrument-muted h-7 px-2.5 text-xs"
            >
              Copy token
            </button>
            <span aria-live="polite" className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
              {copied ? "Copied to clipboard." : ""}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
