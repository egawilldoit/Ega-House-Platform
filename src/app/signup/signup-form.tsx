"use client";

import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  LayoutDashboard,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Sparkles,
  Target,
  TimerReset,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useRef, useState, type FormEvent } from "react";

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

const valueCards = [
  {
    title: "One command center",
    copy: "See priorities, progress, and the next move without rebuilding context.",
    icon: LayoutDashboard,
  },
  {
    title: "Goals into action",
    copy: "Connect long-term outcomes to the tasks that move them forward today.",
    icon: Target,
  },
  {
    title: "A tighter loop",
    copy: "Plan, execute, and reflect from one shared operating system.",
    icon: TimerReset,
  },
] as const;

const trustItems = [
  {
    title: "Email verified",
    copy: "Your workspace unlocks only after you confirm your address.",
    icon: Mail,
  },
  {
    title: "Secure sessions",
    copy: "Supabase-backed sessions work across protected EGA House apps.",
    icon: ShieldCheck,
  },
  {
    title: "You stay in control",
    copy: "Your account and workspace remain private to your authenticated session.",
    icon: LockKeyhole,
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
    <main className={styles.root}>
      <div className={styles.noise} aria-hidden="true" />
      <div className={styles.orb} aria-hidden="true" />
      <div className={styles.shell}>
        <section className={styles.story} aria-labelledby="signup-story-title">
          <div className={styles.brandRow}>
            <span className={styles.badge}>
              <Sparkles size={14} aria-hidden="true" /> EGA House
            </span>
            <span className={styles.liveBadge}>
              <span className={styles.liveDot} aria-hidden="true" /> Public signup
            </span>
          </div>

          <h1 id="signup-story-title" className={styles.headline}>
            Build your
            <span className={styles.headlineAccent}>control room.</span>
          </h1>
          <p className={styles.storyCopy}>
            Turn scattered goals, tasks, focus sessions, and reviews into one operating
            rhythm. Your account is the secure key to every EGA House workspace.
          </p>

          <div className={styles.valueGrid}>
            {valueCards.map(({ title, copy, icon: Icon }) => (
              <article key={title} className={styles.valueCard}>
                <span className={styles.valueIcon} aria-hidden="true">
                  <Icon size={18} />
                </span>
                <div className={styles.valueTitle}>{title}</div>
                <p className={styles.valueCopy}>{copy}</p>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.formColumn} aria-label="Create your EGA House account">
          <div className={styles.formCard}>
            <div className={styles.formContent}>
              {submittedEmail ? (
                <div className={styles.success} role="status" aria-live="polite">
                  <div className={styles.successIcon} aria-hidden="true">
                    <CheckCircle2 size={30} />
                  </div>
                  <div className={styles.eyebrow}>One last step</div>
                  <h2 className={styles.successTitle}>Check your inbox</h2>
                  <p className={styles.successCopy}>
                    We sent a confirmation link to the address below. Your workspace stays
                    locked until you confirm the email.
                  </p>
                  <div className={styles.emailChip}>{submittedEmail}</div>
                  <div className={styles.successActions}>
                    <Link className={styles.textLink} href={loginHref}>
                      Back to sign in
                    </Link>
                    <button className={styles.linkButton} type="button" onClick={restartSignup}>
                      Use a different email
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className={styles.eyebrow}>
                    <UserRound size={14} aria-hidden="true" /> Create account
                  </div>
                  <h2 className={styles.formTitle}>Create your secure workspace</h2>
                  <p className={styles.formIntro}>
                    One account unlocks your dashboard, goals, tasks, timer, and weekly review.
                  </p>

                  <form onSubmit={handleSubmit} noValidate>
                    {submissionError ? (
                      <div
                        ref={errorSummaryRef}
                        className={styles.alert}
                        role="alert"
                        tabIndex={-1}
                      >
                        <AlertCircle size={18} aria-hidden="true" />
                        <span>{submissionError}</span>
                      </div>
                    ) : null}

                    <div className={styles.field}>
                      <div className={styles.labelRow}>
                        <label className={styles.label} htmlFor="signup-name">
                          Your name
                        </label>
                      </div>
                      <div className={styles.inputWrap}>
                        <input
                          ref={nameRef}
                          id="signup-name"
                          className={styles.input}
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
                            if (errors.fullName) setErrors((current) => ({ ...current, fullName: undefined }));
                          }}
                        />
                        <UserRound className={styles.inputIcon} size={17} aria-hidden="true" />
                      </div>
                      {errors.fullName ? (
                        <p id="signup-name-error" className={styles.error}>
                          <AlertCircle size={14} aria-hidden="true" /> {errors.fullName}
                        </p>
                      ) : null}
                    </div>

                    <div className={styles.field}>
                      <div className={styles.labelRow}>
                        <label className={styles.label} htmlFor="signup-email">
                          Email address
                        </label>
                      </div>
                      <div className={styles.inputWrap}>
                        <input
                          ref={emailRef}
                          id="signup-email"
                          className={styles.input}
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
                            if (errors.email) setErrors((current) => ({ ...current, email: undefined }));
                          }}
                        />
                        <Mail className={styles.inputIcon} size={17} aria-hidden="true" />
                      </div>
                      {errors.email ? (
                        <p id="signup-email-error" className={styles.error}>
                          <AlertCircle size={14} aria-hidden="true" /> {errors.email}
                        </p>
                      ) : null}
                    </div>

                    <div className={styles.field}>
                      <div className={styles.labelRow}>
                        <label className={styles.label} htmlFor="signup-password">
                          Password
                        </label>
                        <span className={styles.optionalHint}>12–128 characters</span>
                      </div>
                      <div className={styles.inputWrap}>
                        <input
                          ref={passwordRef}
                          id="signup-password"
                          className={styles.input}
                          type={showPassword ? "text" : "password"}
                          autoComplete="new-password"
                          minLength={12}
                          maxLength={128}
                          required
                          disabled={isSubmitting}
                          value={password}
                          placeholder="A memorable passphrase"
                          aria-invalid={Boolean(errors.password)}
                          aria-describedby="signup-password-help signup-password-error"
                          onChange={(event) => {
                            setPassword(event.target.value);
                            if (errors.password) setErrors((current) => ({ ...current, password: undefined }));
                          }}
                        />
                        <button
                          className={styles.revealButton}
                          type="button"
                          disabled={isSubmitting}
                          aria-label={showPassword ? "Hide password" : "Show password"}
                          onClick={() => setShowPassword((visible) => !visible)}
                        >
                          {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                      </div>
                      <p id="signup-password-help" className={styles.help}>
                        Use at least 12 characters. A short passphrase works well.
                      </p>
                      {errors.password ? (
                        <p id="signup-password-error" className={styles.error}>
                          <AlertCircle size={14} aria-hidden="true" /> {errors.password}
                        </p>
                      ) : null}
                    </div>

                    <div className={styles.securityRow}>
                      <TurnstileWidget
                        siteKey={TURNSTILE_SITE_KEY}
                        onToken={setCaptchaToken}
                        resetSignal={captchaResetSignal}
                      />
                    </div>

                    <button className={styles.submit} type="submit" disabled={isSubmitting}>
                      {isSubmitting ? (
                        <>
                          <span className={styles.spinner} aria-hidden="true" /> Creating account…
                        </>
                      ) : (
                        <>
                          Create my workspace <ArrowRight size={17} aria-hidden="true" />
                        </>
                      )}
                    </button>
                  </form>

                  <p className={styles.accountPrompt}>
                    Already have an account?{" "}
                    <Link className={styles.textLink} href={loginHref}>
                      Sign in
                    </Link>
                  </p>
                </>
              )}
            </div>
          </div>
        </section>

        <section className={styles.trustBar} aria-label="Account safeguards">
          {trustItems.map(({ title, copy, icon: Icon }) => (
            <div key={title} className={styles.trustItem}>
              <Icon size={21} aria-hidden="true" />
              <div>
                <div className={styles.trustTitle}>{title}</div>
                <div className={styles.trustCopy}>{copy}</div>
              </div>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
