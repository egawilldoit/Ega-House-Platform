"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

const PLATFORM_HOST = "egawilldoit.online";

type SafeRedirect =
  | { type: "relative"; href: string }
  | { type: "absolute"; href: string };

function isPlatformHostname(hostname: string) {
  return (
    hostname === PLATFORM_HOST || hostname.endsWith(`.${PLATFORM_HOST}`)
  );
}

function getSafeRedirectTarget(nextValue: string | null): SafeRedirect | null {
  if (!nextValue) {
    return null;
  }

  if (nextValue.startsWith("/")) {
    return nextValue.startsWith("//")
      ? null
      : { type: "relative", href: nextValue };
  }

  try {
    const url = new URL(nextValue);
    const hostname = url.hostname.toLowerCase();
    const protocol = url.protocol.toLowerCase();

    if (!["http:", "https:"].includes(protocol)) {
      return null;
    }

    if (isPlatformHostname(hostname)) {
      return { type: "absolute", href: url.toString() };
    }

    const currentHostname = window.location.hostname.toLowerCase();
    const isLocalDevHost =
      ["localhost", "127.0.0.1"].includes(currentHostname) &&
      url.origin === window.location.origin;

    return isLocalDevHost
      ? { type: "absolute", href: url.toString() }
      : null;
  } catch {
    return null;
  }
}

function getErrorMessage(message?: string) {
  if (!message) {
    return "Unable to sign in. Check your credentials and try again.";
  }

  if (message.includes("Missing env.NEXT_PUBLIC_SUPABASE_URL")) {
    return "Authentication is misconfigured: missing NEXT_PUBLIC_SUPABASE_URL.";
  }

  if (message.includes("Missing env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")) {
    return "Authentication is misconfigured: missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.";
  }

  return message;
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isBusy = isSubmitting || isPending;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    if (!email || !password) {
      setError("Email and password are required.");
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        setError(getErrorMessage(signInError.message));
        return;
      }

      const safeRedirect = getSafeRedirectTarget(searchParams.get("next"));

      if (!safeRedirect) {
        startTransition(() => {
          router.replace("/dashboard");
          router.refresh();
        });
        return;
      }

      if (safeRedirect.type === "relative") {
        startTransition(() => {
          router.replace(safeRedirect.href);
          router.refresh();
        });
        return;
      }

      window.location.assign(safeRedirect.href);
    } catch (submissionError) {
      const message =
        submissionError instanceof Error
          ? submissionError.message
          : "Unexpected sign-in failure.";
      setError(getErrorMessage(message));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-black/10 bg-white/75 p-8 shadow-[0_24px_80px_rgba(15,23,42,0.18)] backdrop-blur-xl sm:p-10">
      <div className="absolute inset-x-8 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(15,23,42,0.18),transparent)]" />
      <div className="absolute inset-x-0 bottom-0 h-24 bg-[radial-gradient(circle_at_bottom,rgba(184,115,51,0.16),transparent_68%)]" />

      <div className="relative">
        <p className="font-mono text-[0.68rem] uppercase tracking-[0.32em] text-slate-500">
          Login
        </p>
        <h2 className="mt-4 text-3xl font-semibold tracking-[-0.06em] text-slate-950">
          Sign in to continue
        </h2>
        <p className="mt-3 text-sm leading-7 text-slate-600">
          Use your email and password to unlock the protected EGA House
          workspaces.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">
              Email
            </span>
            <input
              className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-950 outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-amber-200/60"
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              placeholder="you@egawilldoit.online"
              required
              disabled={isBusy}
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">
              Password
            </span>
            <input
              className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-950 outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-amber-200/60"
              type="password"
              name="password"
              autoComplete="current-password"
              placeholder="Enter your password"
              required
              disabled={isBusy}
            />
          </label>

          {error ? (
            <p
              className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              role="alert"
            >
              {error}
            </p>
          ) : null}

          <button
            className="mt-2 inline-flex h-12 w-full items-center justify-center rounded-full bg-slate-950 px-6 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            type="submit"
            disabled={isBusy}
          >
            {isBusy ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
