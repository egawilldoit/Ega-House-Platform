import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  buildConsentLoginPath,
  normalizeAuthorizationDetails,
  parseAuthorizationId,
} from "@/lib/oauth/consent";
import { createClient } from "@/lib/supabase/server";

import { ConsentApprovalLabel } from "./consent-approval-label";

export const metadata: Metadata = {
  title: "Authorize MCP access",
  description: "Review and approve secure EGA House MCP access.",
};

type ConsentPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const SCOPE_DESCRIPTIONS: Record<string, string> = {
  openid: "Confirm your EGA House account identity",
  email: "Share the email address attached to your account",
  profile: "Share your basic account profile",
  phone: "Share the phone number attached to your account",
};

function readSingleParameter(
  value: string | string[] | undefined,
): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parsePreviouslyApprovedRedirect(data: unknown): string {
  if (
    typeof data !== "object"
    || data === null
    || !("redirect_url" in data)
    || typeof data.redirect_url !== "string"
    || data.redirect_url.length > 4096
  ) {
    throw new Error("Invalid OAuth authorization response.");
  }

  const redirectUrl = new URL(data.redirect_url);
  if (redirectUrl.protocol !== "https:" && redirectUrl.protocol !== "http:") {
    throw new Error("Invalid OAuth authorization response.");
  }

  return redirectUrl.toString();
}

function ConsentError({ message }: { message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--ega-bg)] px-6 py-16 text-[color:var(--ega-text)]">
      <section className="w-full max-w-xl rounded-[var(--radius-xl)] border border-[var(--ega-border)] bg-[color:var(--ega-surface)] p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--status-overdue)]">
          Authorization unavailable
        </p>
        <h1 className="mt-3 text-[length:var(--text-section)] font-semibold">The request cannot be reviewed.</h1>
        <p className="mt-4 leading-7 text-[color:var(--ega-text-secondary)]">{message}</p>
      </section>
    </main>
  );
}

export default async function OAuthConsentPage({
  searchParams,
}: ConsentPageProps) {
  const parameters = await searchParams;
  let authorizationId: string;

  try {
    authorizationId = parseAuthorizationId(
      readSingleParameter(parameters.authorization_id),
    );
  } catch {
    return <ConsentError message="The OAuth authorization identifier is missing or invalid." />;
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect(buildConsentLoginPath(authorizationId));
  }

  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(
    authorizationId,
  );

  if (error || !data) {
    return <ConsentError message="This authorization request is invalid or has expired. Start the connection again from your MCP client." />;
  }

  if (!("authorization_id" in data)) {
    redirect(parsePreviouslyApprovedRedirect(data));
  }

  let details;
  try {
    details = normalizeAuthorizationDetails(data);
  } catch {
    return <ConsentError message="The requesting OAuth application returned incomplete authorization details." />;
  }

  const decisionError = readSingleParameter(parameters.error);
  const writesEnabled = process.env.MCP_WRITES_ENABLED === "true";

  return (
    <main className="min-h-screen bg-[var(--ega-bg)] px-6 py-14 text-[color:var(--ega-text)]">
      <div className="mx-auto grid w-full max-w-5xl gap-8 lg:grid-cols-[1fr_1.15fr]">
        <section className="flex flex-col justify-between rounded-[var(--radius-xl)] border border-[var(--ega-ink)] bg-[color:var(--ega-ink)] p-8 text-white lg:p-10">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[white/70">
              EGA House MCP
            </p>
            <h1 className="mt-5 text-[length:var(--text-page)] font-semibold leading-tight lg:text-[length:var(--text-page)]">
              {writesEnabled ? "Choose workspace access level." : "Approve read-only workspace access."}
            </h1>
            <p className="mt-5 max-w-md leading-7 text-[white/75">
              {writesEnabled
                ? "Grant read-only inspection or full workspace management. Workspace management can create and update projects, goals, tasks, Today and timers — still scoped to your account and client."
                : "The requesting client will be able to inspect your projects, goals, tasks, Today plan, and timer sessions. It cannot create, edit, archive, merge, deploy, or run commands through this authorization."}
            </p>
          </div>

          <div className="mt-10 rounded-[var(--radius-lg)] border border-white/20 bg-white/5 p-5 text-sm leading-6 text-white/80">
            Access is bound to your account, this OAuth client, and the exact EGA
            House MCP resource. You can revoke the connection later.
          </div>
        </section>

        <section className="rounded-[var(--radius-xl)] border border-[var(--ega-border)] bg-[color:var(--ega-surface)] p-8 lg:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--status-overdue)]">
            Authorization request
          </p>
          <h2 className="mt-3 text-[length:var(--text-section)] font-semibold">Connect {details.clientName}</h2>
          <p className="mt-3 leading-7 text-[color:var(--ega-text-secondary)]">
            Signed in as <span className="font-medium text-[color:var(--ega-text)]">{user.email ?? user.id}</span>
          </p>

          {decisionError ? (
            <div className="mt-6 feedback-block feedback-block-error mt-6">
              Authorization could not be completed. Review the request and try again.
            </div>
          ) : null}

          <form action="/api/oauth/decision" method="post" className="mt-8 space-y-6">
            <input type="hidden" name="authorization_id" value={details.authorizationId} />
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-[color:var(--ega-text-tertiary)]">
                EGA House permissions
              </h3>
              {writesEnabled ? (
                <fieldset className="mt-3 space-y-3">
                  <legend className="sr-only">Permission level</legend>
                  <label className="flex gap-3 rounded-[var(--radius-lg)] border border-[var(--ega-border)] bg-[color:var(--ega-surface)] p-4 has-[input:checked]:border-[var(--ega-ink)]">
                    <input type="radio" name="permission_profile" value="read_only" defaultChecked className="mt-1" />
                    <span>
                      <span className="font-semibold">Read-only</span>
                      <span className="mt-1 block text-sm leading-6 text-[color:var(--ega-text-secondary)]">List projects, goals, tasks, Today plan and timer sessions. No writes.</span>
                    </span>
                  </label>
                  <label className="flex gap-3 rounded-[var(--radius-lg)] border border-[var(--ega-border)] bg-[color:var(--ega-surface)] p-4 has-[input:checked]:border-[var(--ega-ink)]">
                    <input type="radio" name="permission_profile" value="workspace_manager" className="mt-1" />
                    <span>
                      <span className="font-semibold">Workspace management</span>
                      <span className="mt-1 block text-sm leading-6 text-[color:var(--ega-text-secondary)]">Read plus create/update projects, goals, tasks, Today and timers. Still owner-scoped and client-bound.</span>
                    </span>
                  </label>
                </fieldset>
              ) : (
                <ul className="mt-3 space-y-3">
                  {[
                    ["Projects", "List projects that belong to your account"],
                    ["Goals", "List goals that belong to your account"],
                    ["Tasks", "List and filter tasks that belong to your account"],
                    ["Today plan", "Inspect the plan for your account's current day"],
                    ["Timer sessions", "Inspect timer sessions that belong to your account"],
                  ].map(([label, description]) => (
                    <li key={label} className="rounded-[var(--radius-lg)] border border-[var(--ega-border)] bg-[color:var(--ega-surface-subtle)] p-4">
                      <p className="font-semibold">Read {label}</p>
                      <p className="mt-1 text-sm leading-6 text-[color:var(--ega-text-secondary)]">{description}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {details.scopes.length > 0 ? (
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-[color:var(--ega-text-tertiary)]">
                  Identity information
                </h3>
                <ul className="mt-3 space-y-2 text-sm text-[color:var(--ega-text-secondary)]">
                  {details.scopes.map((scope) => (
                    <li key={scope} className="flex gap-3 rounded-[var(--radius-sm)] bg-black/[0.035] px-4 py-3">
                      <span aria-hidden className="mt-0.5 text-[color:var(--status-overdue)]">•</span>
                      <span>{SCOPE_DESCRIPTIONS[scope] ?? `Requested OAuth scope: ${scope}`}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {details.redirectUri ? (
              <div className="rounded-[var(--radius-lg)] border border-[var(--ega-border)] bg-black/[0.025] p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--ega-text-tertiary)]">
                  Return address
                </p>
                <p className="mt-2 break-all font-mono text-xs leading-5 text-[color:var(--ega-text-secondary)]">
                  {details.redirectUri}
                </p>
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2 pt-2">
              <button
                type="submit"
                name="decision"
                value="deny"
                className="rounded-[var(--radius-sm)] border border-black/15 px-5 py-3.5 font-semibold transition hover:bg-black/5"
              >
                Deny
              </button>
              <button
                type="submit"
                name="decision"
                value="approve"
                className="btn-instrument flex h-9 items-center justify-center px-4 font-semibold"
              >
                <ConsentApprovalLabel />
              </button>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}
