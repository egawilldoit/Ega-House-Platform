import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getLaunchPagePath } from "@ega/domain/preferences";

import { AuthFeedback } from "@/app/auth-ui/auth-feedback";
import { AuthHeader } from "@/app/auth-ui/auth-header";
import { AuthShell } from "@/app/auth-ui/auth-shell";
import { createClient } from "@/lib/supabase/server";
import { getWebUserPreferences } from "@/lib/services/user-preferences-service";

import { LoginForm } from "./login-form";

const PUBLIC_SIGNUP_PATH = "/signup";

/** An already-signed-in visit goes to its requested internal path or the owner's launch page. */
async function resolveAuthenticatedLanding(rawNext: unknown): Promise<string> {
  if (typeof rawNext === "string" && rawNext.startsWith("/") && !rawNext.startsWith("//")) {
    return rawNext;
  }
  const preferences = await getWebUserPreferences();
  return getLaunchPagePath(preferences.launchPage);
}

export const metadata: Metadata = {
  title: "Login",
  description: "Sign in to access your EGA House workspace.",
};

function LoginFormFallback({ signupHref }: { signupHref: string }) {
  return (
    <AuthShell theme="house-cream">
      <AuthHeader
        status="Sign in"
        actionHref={signupHref}
        actionLabel="Create account"
      />
      <div className="auth-stage" aria-label="Loading sign in">
        <div className="auth-layout">
          <section className="auth-story">
            <p className="auth-kicker">The operating loop is waiting.</p>
            <div className="auth-display">Return to the system.</div>
          </section>
          <section className="auth-form-column">
            <div className="auth-form-frame">
              <div className="auth-form-eyebrow">Preparing secure access</div>
              <div className="auth-form-title">Sign in to continue</div>
              <p className="auth-form-copy">Loading the protected account form…</p>
            </div>
          </section>
        </div>
      </div>
    </AuthShell>
  );
}

type LoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect(await resolveAuthenticatedLanding(params.next));
  }

  const nextParam = typeof params.next === "string" ? params.next : null;
  const signupHref = nextParam
    ? `${PUBLIC_SIGNUP_PATH}?next=${encodeURIComponent(nextParam)}`
    : PUBLIC_SIGNUP_PATH;
  const confirmationFailed = params.error === "confirmation_failed";

  return (
    <>
      {confirmationFailed ? (
        <AuthFeedback className="auth-page-alert">
          That confirmation link is invalid or expired. Create a new account or sign in if you
          already confirmed it.
        </AuthFeedback>
      ) : null}

      <Suspense fallback={<LoginFormFallback signupHref={signupHref} />}>
        <LoginForm signupHref={signupHref} />
      </Suspense>
    </>
  );
}
