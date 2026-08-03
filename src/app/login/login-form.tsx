"use client";

import { Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import { AuthFeedback } from "@/app/auth-ui/auth-feedback";
import { AuthField } from "@/app/auth-ui/auth-field";
import { AuthGeometry } from "@/app/auth-ui/auth-geometry";
import { AuthHeader } from "@/app/auth-ui/auth-header";
import { AuthReveal } from "@/app/auth-ui/auth-motion";
import { AuthShell } from "@/app/auth-ui/auth-shell";
import { AuthStudyLabel } from "@/app/auth-ui/auth-study-label";
import { AuthSubmit } from "@/app/auth-ui/auth-submit";
import { createClient } from "@/lib/supabase/client";

const PLATFORM_HOST = "egawilldoit.online";

function getSafeRedirect(raw: string | null): URL | null {
  if (!raw) return null;
  try {
    if (raw.startsWith("/") && !raw.startsWith("//")) {
      return new URL(raw, window.location.origin);
    }
    const url = new URL(raw);
    if (
      url.hostname === PLATFORM_HOST ||
      url.hostname.endsWith(`.${PLATFORM_HOST}`) ||
      url.hostname === "localhost"
    ) {
      return url;
    }
  } catch {
    // Invalid or untrusted redirect values fall back to the dashboard.
  }
  return null;
}

type LoginFormProps = {
  signupHref: string;
};

const loginNotes = [
  {
    number: "01",
    title: "Resume the workspace",
    copy: "Return to the same goals, tasks, focus context, and review rhythm.",
  },
  {
    number: "02",
    title: "Keep one session",
    copy: "Use the protected root-domain session across approved EGA House surfaces.",
  },
  {
    number: "03",
    title: "Stay owner-scoped",
    copy: "Your authenticated workspace remains private to your account.",
  },
] as const;

export function LoginForm({ signupHref }: LoginFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        if (authError.message.includes("Missing env.NEXT_PUBLIC_SUPABASE_URL")) {
          setError("Supabase URL is not configured. Check your environment variables.");
        } else if (
          authError.message.includes("Missing env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")
        ) {
          setError("Supabase key is not configured. Check your environment variables.");
        } else {
          setError(authError.message);
        }
        return;
      }

      const nextParam = searchParams.get("next");
      const safeRedirect = getSafeRedirect(nextParam);

      if (!safeRedirect || safeRedirect.origin === window.location.origin) {
        const path = safeRedirect
          ? safeRedirect.pathname + safeRedirect.search + safeRedirect.hash
          : "/dashboard";
        router.replace(path);
        router.refresh();
      } else {
        window.location.assign(safeRedirect.href);
      }
    });
  }

  return (
    <AuthShell theme="black-signal">
      <AuthHeader
        status="AUTH / SIGN IN"
        actionHref={signupHref}
        actionLabel="Create account"
      />

      <div className="auth-stage">
        <AuthStudyLabel number="AUTH 01" title="SIGN IN" direction="BLACK SIGNAL" />

        <div className="auth-layout">
          <section className="auth-story" aria-labelledby="login-story-title">
            <AuthGeometry variant="focus" />
            <AuthReveal>
              <p className="auth-kicker">The operating loop is waiting.</p>
              <h1 id="login-story-title" className="auth-display">
                Return to
                <span className="auth-display__accent">the system.</span>
              </h1>
              <p className="auth-lead">
                Reconnect to the workspace where goals become plans, focused sessions become
                evidence, and each week closes with a deliberate review.
              </p>
            </AuthReveal>

            <AuthReveal delay={0.08}>
              <ol className="auth-operation-list" aria-label="Sign-in safeguards">
                {loginNotes.map((note) => (
                  <li key={note.number}>
                    <span>{note.number}</span>
                    <strong>{note.title}</strong>
                    <small>{note.copy}</small>
                  </li>
                ))}
              </ol>
            </AuthReveal>
          </section>

          <section className="auth-form-column" aria-label="Sign in to EGA House">
            <AuthReveal delay={0.14}>
              <div className="auth-form-frame">
                <div className="auth-form-eyebrow">
                  <LockKeyhole size={14} aria-hidden="true" /> Protected access
                </div>
                <h2 className="auth-form-title">Sign in to continue</h2>
                <p className="auth-form-copy">
                  Use your confirmed email and password to reopen your EGA House workspace.
                </p>

                <form onSubmit={handleSubmit}>
                  {error ? <AuthFeedback>{error}</AuthFeedback> : null}

                  <AuthField id="login-email" label="Email address">
                    <input
                      id="login-email"
                      className="auth-input"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      required
                      disabled={isPending}
                      value={email}
                      placeholder="you@example.com"
                      onChange={(event) => setEmail(event.target.value)}
                    />
                    <Mail
                      aria-hidden="true"
                      size={17}
                      style={{ position: "absolute", right: "1rem", top: "1.1rem", opacity: 0.48 }}
                    />
                  </AuthField>

                  <AuthField
                    id="login-password"
                    label="Password"
                    trailing={
                      <button
                        className="auth-icon-button"
                        type="button"
                        disabled={isPending}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        onClick={() => setShowPassword((visible) => !visible)}
                      >
                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    }
                  >
                    <input
                      id="login-password"
                      className="auth-input"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      required
                      disabled={isPending}
                      value={password}
                      placeholder="Enter your password"
                      onChange={(event) => setPassword(event.target.value)}
                    />
                  </AuthField>

                  <AuthSubmit type="submit" pending={isPending} pendingLabel="Signing in…">
                    Enter workspace
                  </AuthSubmit>
                </form>

                <p className="auth-account-prompt">
                  New to EGA House?{" "}
                  <Link className="auth-text-link" href={signupHref}>
                    Create your account
                  </Link>
                </p>
              </div>

              <div className="auth-security-meta" aria-label="Session safeguards">
                <div>
                  <strong>Server verified</strong>
                  <span>Protected session checks</span>
                </div>
                <div>
                  <strong>Owner scoped</strong>
                  <span>Private workspace access</span>
                </div>
                <div>
                  <strong>Safe return path</strong>
                  <span>Validated next destination</span>
                </div>
              </div>
            </AuthReveal>
          </section>
        </div>
      </div>
    </AuthShell>
  );
}
