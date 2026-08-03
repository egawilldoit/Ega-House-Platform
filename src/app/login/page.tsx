import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AuthFeedback } from "@/app/auth-ui/auth-feedback";
import { AuthHeader } from "@/app/auth-ui/auth-header";
import { AuthShell } from "@/app/auth-ui/auth-shell";
import { AuthStudyLabel } from "@/app/auth-ui/auth-study-label";
import { createClient } from "@/lib/supabase/server";

import { LoginForm } from "./login-form";

const PUBLIC_SIGNUP_URL = "https://www.egawilldoit.online/signup";

export const metadata: Metadata = {
  title: "Login",
  description: "Sign in to access your EGA House workspace.",
};

function LoginFormFallback({ signupHref }: { signupHref: string }) {
  return (
    <AuthShell theme="black-signal">
      <AuthHeader
        status="AUTH / SIGN IN"
        actionHref={signupHref}
        actionLabel="Create account"
      />
      <div className="auth-stage" aria-label="Loading sign in">
        <AuthStudyLabel number="AUTH 01" title="SIGN IN" direction="BLACK SIGNAL" />
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
    redirect("/dashboard");
  }

  const nextParam = typeof params.next === "string" ? params.next : null;
  const signupHref = nextParam
    ? `${PUBLIC_SIGNUP_URL}?next=${encodeURIComponent(nextParam)}`
    : PUBLIC_SIGNUP_URL;
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
