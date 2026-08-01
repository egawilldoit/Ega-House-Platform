import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  buildConsentLoginPath,
  normalizeAuthorizationDetails,
  parseAuthorizationId,
} from "@/lib/oauth/consent";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Authorize MCP access",
  description: "Review and approve read-only EGA House MCP access.",
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
    <main className="flex min-h-screen items-center justify-center bg-[#f4ed9a] px-6 py-16 text-[#17383a]">
      <section className="w-full max-w-xl rounded-3xl border border-black/10 bg-white/75 p-8 shadow-2xl shadow-black/10 backdrop-blur">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#b54132]">
          Authorization unavailable
        </p>
        <h1 className="mt-3 text-3xl font-semibold">The request cannot be reviewed.</h1>
        <p className="mt-4 leading-7 text-black/65">{message}</p>
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

  return (
    <main className="min-h-screen bg-[#f4ed9a] px-6 py-14 text-[#17383a]">
      <div className="mx-auto grid w-full max-w-5xl gap-8 lg:grid-cols-[1fr_1.15fr]">
        <section className="flex flex-col justify-between rounded-3xl border border-black/10 bg-[#17383a] p-8 text-[#f4ed9a] shadow-2xl shadow-black/15 lg:p-10">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#f4ed9a]/65">
              EGA House MCP
            </p>
            <h1 className="mt-5 text-4xl font-semibold leading-tight lg:text-5xl">
              Approve read-only workspace access.
            </h1>
            <p className="mt-5 max-w-md leading-7 text-[#f4ed9a]/70">
              The requesting client will be able to inspect your projects, goals,
              and tasks. It cannot create, edit, archive, merge, deploy, or run
              commands through this authorization.
            </p>
          </div>

          <div className="mt-10 rounded-2xl border border-[#f4ed9a]/20 bg-white/5 p-5 text-sm leading-6 text-[#f4ed9a]/75">
            Access is bound to your account, this OAuth client, and the exact EGA
            House MCP resource. You can revoke the connection later.
          </div>
        </section>

        <section className="rounded-3xl border border-black/10 bg-white/80 p-8 shadow-2xl shadow-black/10 backdrop-blur lg:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#b54132]">
            Authorization request
          </p>
          <h2 className="mt-3 text-3xl font-semibold">Connect {details.clientName}</h2>
          <p className="mt-3 leading-7 text-black/60">
            Signed in as <span className="font-medium text-[#17383a]">{user.email ?? user.id}</span>
          </p>

          {decisionError ? (
            <div className="mt-6 rounded-2xl border border-[#b54132]/25 bg-[#b54132]/5 px-4 py-3 text-sm text-[#8f3025]">
              Authorization could not be completed. Review the request and try again.
            </div>
          ) : null}

          <div className="mt-8 space-y-6">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-black/45">
                EGA House permissions
              </h3>
              <ul className="mt-3 space-y-3">
                {[
                  ["Projects", "List projects that belong to your account"],
                  ["Goals", "List goals that belong to your account"],
                  ["Tasks", "List and filter tasks that belong to your account"],
                ].map(([label, description]) => (
                  <li key={label} className="rounded-2xl border border-black/10 bg-white/60 p-4">
                    <p className="font-semibold">Read {label}</p>
                    <p className="mt-1 text-sm leading-6 text-black/55">{description}</p>
                  </li>
                ))}
              </ul>
            </div>

            {details.scopes.length > 0 ? (
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-black/45">
                  Identity information
                </h3>
                <ul className="mt-3 space-y-2 text-sm text-black/65">
                  {details.scopes.map((scope) => (
                    <li key={scope} className="flex gap-3 rounded-xl bg-black/[0.035] px-4 py-3">
                      <span aria-hidden className="mt-0.5 text-[#b54132]">•</span>
                      <span>{SCOPE_DESCRIPTIONS[scope] ?? `Requested OAuth scope: ${scope}`}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {details.redirectUri ? (
              <div className="rounded-2xl border border-black/10 bg-black/[0.025] p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-black/45">
                  Return address
                </p>
                <p className="mt-2 break-all font-mono text-xs leading-5 text-black/65">
                  {details.redirectUri}
                </p>
              </div>
            ) : null}
          </div>

          <form action="/api/oauth/decision" method="post" className="mt-8 grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="authorization_id" value={details.authorizationId} />
            <button
              type="submit"
              name="decision"
              value="deny"
              className="rounded-xl border border-black/15 px-5 py-3.5 font-semibold transition hover:bg-black/5"
            >
              Deny
            </button>
            <button
              type="submit"
              name="decision"
              value="approve"
              className="rounded-xl bg-[#17383a] px-5 py-3.5 font-semibold text-[#f4ed9a] transition hover:bg-[#102a2c]"
            >
              Approve read-only access
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
