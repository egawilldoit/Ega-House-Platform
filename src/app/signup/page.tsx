import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AuthHeader } from "@/app/auth-ui/auth-header";
import { AuthShell } from "@/app/auth-ui/auth-shell";
import { AuthStudyLabel } from "@/app/auth-ui/auth-study-label";
import { createClient } from "@/lib/supabase/server";

import { SignupForm } from "./signup-form";

export const metadata: Metadata = {
  title: "Create account",
  description: "Create your secure EGA House workspace.",
};

function SignupFallback() {
  return (
    <AuthShell theme="signal-cream">
      <AuthHeader status="AUTH / CREATE" actionHref="/login" actionLabel="Sign in" />
      <div className="auth-stage" aria-label="Loading signup">
        <AuthStudyLabel number="AUTH 02" title="CREATE" direction="SIGNAL CREAM" />
        <div className="auth-layout">
          <section className="auth-story">
            <p className="auth-kicker">A workspace starts with one deliberate account.</p>
            <div className="auth-display">Build your control room.</div>
          </section>
          <section className="auth-form-column">
            <div className="auth-form-frame">
              <div className="auth-form-eyebrow">Preparing signup</div>
              <div className="auth-form-title">Create your secure workspace</div>
              <p className="auth-form-copy">Loading the protected account form…</p>
            </div>
          </section>
        </div>
      </div>
    </AuthShell>
  );
}

export default async function SignupPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <Suspense fallback={<SignupFallback />}>
      <SignupForm />
    </Suspense>
  );
}
