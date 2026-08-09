"use client";

import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useRef, useState, type FormEvent } from "react";

import { AuthFeedback } from "@/app/auth-ui/auth-feedback";
import { AuthField } from "@/app/auth-ui/auth-field";
import { AuthGeometry } from "@/app/auth-ui/auth-geometry";
import { AuthHeader } from "@/app/auth-ui/auth-header";
import { AuthReveal } from "@/app/auth-ui/auth-motion";
import { AuthShell } from "@/app/auth-ui/auth-shell";
import { AuthStudyLabel } from "@/app/auth-ui/auth-study-label";
import { AuthSubmit } from "@/app/auth-ui/auth-submit";
import {
  resolveSafeAuthDestination,
  toInternalDestination,
} from "@/lib/auth/safe-redirect";
import { createClient } from "@/lib/supabase/client";

import styles from "./signup.module.css";
import {
  normalizeSignupEmail,
  normalizeSignupName,
  validateSignupFields,
  type SignupFieldErrors,
} from "./signup-validation";
import { TurnstileWidget } from "./TurnstileWidget";

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

const valueNotes = [
  {
    number: "01",
    title: "One command surface",
    copy: "See priorities, progress, and the next move without rebuilding context.",
  },
  {
    number: "02",
    title: "Goals into action",
    copy: "Connect long-term outcomes to the work that moves them forward today.",
  },
  {
    number: "03",
    title: "A tighter loop",
    copy: "Plan, execute, and reflect from one shared operating system.",
  },
] as const;

function mapSignupError(message: string) {
  const normalized = message.toLowerCase();

  if (normalized.includes("missing env.next_public_supabase")) {
    return "Signup is not configured on this deployment yet. Please contact support.";
  }

  if (normalized.includes("captcha") || normalized.includes("challenge")) {
    return "The security check expired or could not be verified. Complete it again and retry.";
  }

  if (normalized.includes("rate") || normalized.includes("too many")) {
    return "Too many signup attempts were made. Wait a few minutes, then try again.";
  }

  if (normalized.includes("already") || normalized.includes("registered")) {
    return "We could not create this account. Try signing in, or use another email.";
  }

  if (normalized.includes("password")) {
    return "That password was not accepted. Use a longer passphrase and try again.";
  }

  return "We could not create your account right now. Check your details and try again.";
}

export function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<SignupFieldErrors>({});
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaResetSignal, setCaptchaResetSignal] = useState(0);

  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);

  const nextParam = searchParams.get("next");
  const loginHref = useMemo(() => {
    if (!nextParam) return "/login";
    return `/login?next=${encodeURIComponent(nextParam)}`;
  }, [nextParam]);

  function focusFirstError(fieldErrors: SignupFieldErrors) {
    const ref = fieldErrors.fullName
      ? nameRef
      : fieldErrors.email
        ? emailRef
        : passwordRef;
    requestAnimationFrame(() => ref.current?.focus());
  }

  function navigateAfterAuth(destination: URL) {
    const internalPath = toInternalDestination(destination, window.location.origin);
    if (internalPath) {
      router.replace(internalPath);
      router.refresh();
      return;
    }
    window.location.assign(destination.href);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmissionError(null);

    const fieldErrors = validateSignupFields({ fullName, email, password });
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) {
      focusFirstError(fieldErrors);
      return;
    }

    if (TURNSTILE_SITE_KEY && !captchaToken) {
      setSubmissionError("Complete the security check before creating your account.");
      requestAnimationFrame(() => errorSummaryRef.current?.focus());
      return;
    }

    const normalizedName = normalizeSignupName(fullName);
    const normalizedEmail = normalizeSignupEmail(email);
    const destination = resolveSafeAuthDestination(nextParam, window.location.origin);
    const confirmationUrl = new URL("/auth/confirm", window.location.origin);
    confirmationUrl.searchParams.set("next", destination.href);

    setIsSubmitting(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          data: { full_name: normalizedName },
          emailRedirectTo: confirmationUrl.href,
          captchaToken: captchaToken ?? undefined,
        },
      });

      if (error) {
        setSubmissionError(mapSignupError(error.message));
        setCaptchaResetSignal((value) => value + 1);
        requestAnimationFrame(() => errorSummaryRef.current?.focus());
        return;
      }

      if (data.session) {
        navigateAfterAuth(destination);
        return;
      }

      setSubmittedEmail(normalizedEmail);
      setPassword("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setSubmissionError(mapSignupError(message));
      setCaptchaResetSignal((value) => value + 1);
      requestAnimationFrame(() => errorSummaryRef.current?.focus());
    } finally {
      setIsSubmitting(false);
    }
  }

  function restartSignup() {
    setSubmittedEmail(null);
    setSubmissionError(null);
    setErrors({});
    setCaptchaToken(null);
    setCaptchaResetSignal((value) => value + 1);
    requestAnimationFrame(() => emailRef.current?.focus());
  }

  return (
    <AuthShell theme="signal-cream">
      <AuthHeader status="AUTH / CREATE" actionHref={loginHref} actionLabel="Sign in" />

      <div className="auth-stage">
        <AuthStudyLabel number="AUTH 02" title="CREATE" direction="SIGNAL CREAM" />

        <div className="auth-layout">
          <section className="auth-story" aria-labelledby="signup-story-title">
            <AuthGeometry variant="orbit" />
            <AuthReveal>
              <p className="auth-kicker">A workspace starts with one deliberate account.</p>
              <h1 id="signup-story-title" className="auth-display">
                Build your
                <span className="auth-display__accent">control room.</span>
              </h1>
              <p className="auth-lead">
                Turn scattered goals, tasks, focus sessions, and reviews into one operating
                rhythm. Your account is the secure key to the full EGA House workspace.
              </p>
            </AuthReveal>

            <AuthReveal delay={0.08}>
              <ol className="auth-operation-list" aria-label="Workspace benefits">
                {valueNotes.map((note) => (
                  <li key={note.number}>
                    <span>{note.number}</span>
                    <strong>{note.title}</strong>
                    <small>{note.copy}</small>
                  </li>
                ))}
              </ol>
            </AuthReveal>
          </section>

          <section className="auth-form-column" aria-label="Create your EGA House account">
            <AuthReveal delay={0.14}>
              <div className="auth-form-frame">
                {submittedEmail ? (
                  <div className="auth-success" role="status" aria-live="polite">
                    <div className="auth-success__mark" aria-hidden="true">
                      <CheckCircle2 size={30} />
                    </div>
                    <div className="auth-form-eyebrow">One last step</div>
                    <h2 className="auth-form-title">Check your inbox</h2>
                    <p className="auth-form-copy">
                      We sent a confirmation link to the address below. Your workspace stays
                      locked until you confirm the email.
                    </p>
                    <div className="auth-email-chip">{submittedEmail}</div>
                    <div className="auth-success__actions">
                      <Link className="auth-text-link" href={loginHref}>
                        Back to sign in
                      </Link>
                      <button className="auth-link-button" type="button" onClick={restartSignup}>
                        Use a different email
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="auth-form-eyebrow">
                      <UserRound size={14} aria-hidden="true" /> Create account
                    </div>
                    <h2 className="auth-form-title">Create your secure workspace</h2>
                    <p className="auth-form-copy">
                      One account unlocks your dashboard, goals, tasks, timer, and weekly review.
                    </p>

                    <form onSubmit={handleSubmit} noValidate>
                      {submissionError ? (
                        <AuthFeedback ref={errorSummaryRef} tabIndex={-1}>
                          {submissionError}
                        </AuthFeedback>
                      ) : null}

                      <AuthField
                        id="signup-name"
                        label="Your name"
                        error={
                          errors.fullName ? (
                            <>
                              <AlertCircle size={14} aria-hidden="true" /> {errors.fullName}
                            </>
                          ) : undefined
                        }
                      >
                        <input
                          ref={nameRef}
                          id="signup-name"
                          className="auth-input"
                          type="text"
                          autoComplete="name"
                          maxLength={100}
                          required
                          disabled={isSubmitting}
                          value={fullName}
                          placeholder="How should we greet you?"
                          aria-invalid={Boolean(errors.fullName)}
                          aria-describedby={errors.fullName ? "signup-name-error" : undefined}
                          onChange={(event) => {
                            setFullName(event.target.value);
                            if (errors.fullName) {
                              setErrors((current) => ({ ...current, fullName: undefined }));
                            }
                          }}
                        />
                        <UserRound
                          aria-hidden="true"
                          size={17}
                          style={{ position: "absolute", right: "1rem", top: "1.1rem", opacity: 0.48 }}
                        />
                        {errors.fullName ? (
                          <span id="signup-name-error" className={styles.srOnly}>
                            {errors.fullName}
                          </span>
                        ) : null}
                      </AuthField>

                      <AuthField
                        id="signup-email"
                        label="Email address"
                        error={
                          errors.email ? (
                            <>
                              <AlertCircle size={14} aria-hidden="true" /> {errors.email}
                            </>
                          ) : undefined
                        }
                      >
                        <input
                          ref={emailRef}
                          id="signup-email"
                          className="auth-input"
                          type="email"
                          inputMode="email"
                          autoComplete="email"
                          required
                          disabled={isSubmitting}
                          value={email}
                          placeholder="you@example.com"
                          aria-invalid={Boolean(errors.email)}
                          aria-describedby={errors.email ? "signup-email-error" : undefined}
                          onChange={(event) => {
                            setEmail(event.target.value);
                            if (errors.email) {
                              setErrors((current) => ({ ...current, email: undefined }));
                            }
                          }}
                        />
                        <Mail
                          aria-hidden="true"
                          size={17}
                          style={{ position: "absolute", right: "1rem", top: "1.1rem", opacity: 0.48 }}
                        />
                        {errors.email ? (
                          <span id="signup-email-error" className={styles.srOnly}>
                            {errors.email}
                          </span>
                        ) : null}
                      </AuthField>

                      <AuthField
                        id="signup-password"
                        label="Password"
                        hint="12–128 characters"
                        help={<span id="signup-password-help">Use at least 12 characters. A short passphrase works well.</span>}
                        error={
                          errors.password ? (
                            <>
                              <AlertCircle size={14} aria-hidden="true" /> {errors.password}
                            </>
                          ) : undefined
                        }
                        trailing={
                          <button
                            className="auth-icon-button"
                            type="button"
                            disabled={isSubmitting}
                            aria-label={showPassword ? "Hide password" : "Show password"}
                            onClick={() => setShowPassword((visible) => !visible)}
                          >
                            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                          </button>
                        }
                      >
                        <input
                          ref={passwordRef}
                          id="signup-password"
                          className="auth-input"
                          type={showPassword ? "text" : "password"}
                          autoComplete="new-password"
                          minLength={12}
                          maxLength={128}
                          required
                          disabled={isSubmitting}
                          value={password}
                          placeholder="A memorable passphrase"
                          aria-invalid={Boolean(errors.password)}
                          aria-describedby={
                            errors.password
                              ? "signup-password-help signup-password-error"
                              : "signup-password-help"
                          }
                          onChange={(event) => {
                            setPassword(event.target.value);
                            if (errors.password) {
                              setErrors((current) => ({ ...current, password: undefined }));
                            }
                          }}
                        />
                        {errors.password ? (
                          <span id="signup-password-error" className={styles.srOnly}>
                            {errors.password}
                          </span>
                        ) : null}
                      </AuthField>

                      <div className={styles.securityRow}>
                        <TurnstileWidget
                          siteKey={TURNSTILE_SITE_KEY}
                          onToken={setCaptchaToken}
                          resetSignal={captchaResetSignal}
                        />
                      </div>

                      <AuthSubmit
                        type="submit"
                        pending={isSubmitting}
                        pendingLabel="Creating account…"
                      >
                        Create my workspace
                      </AuthSubmit>
                    </form>

                    <p className="auth-account-prompt">
                      Already have an account?{" "}
                      <Link className="auth-text-link" href={loginHref}>
                        Sign in
                      </Link>
                    </p>
                  </>
                )}
              </div>

              <div className="auth-security-meta" aria-label="Account safeguards">
                <div>
                  <strong>Email verified</strong>
                  <span>Workspace unlocks after confirmation</span>
                </div>
                <div>
                  <strong>Secure sessions</strong>
                  <span>Supabase protected authentication</span>
                </div>
                <div>
                  <strong>Owner controlled</strong>
                  <span>Private authenticated workspace</span>
                </div>
              </div>
            </AuthReveal>
          </section>
        </div>
      </div>
    </AuthShell>
  );
}
