"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

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
    // ignore
  }
  return null;
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
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
        } else if (authError.message.includes("Missing env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")) {
          setError("Supabase key is not configured. Check your environment variables.");
        } else {
          setError(authError.message);
        }
        return;
      }

      const nextParam = searchParams.get("next");
      const safeRedirect = getSafeRedirect(nextParam);

      if (!safeRedirect || safeRedirect.origin === window.location.origin) {
        router.replace(safeRedirect?.pathname ?? "/dashboard");
        router.refresh();
      } else {
        window.location.assign(safeRedirect.href);
      }
    });
  }

  return (
    <div className="w-full rounded-2xl border border-white/10 bg-white/[0.03] p-10 backdrop-blur-xl shadow-[0_0_80px_rgba(0,0,0,0.6)]">
      {/* Header */}
      <div className="mb-9">
        <p className="font-mono text-[0.62rem] uppercase tracking-[0.3em] text-slate-500 mb-3">
          Login
        </p>
        <p className="text-xl font-semibold text-white tracking-tight leading-tight">
          Sign in to continue
        </p>
        <p className="mt-2 text-sm text-slate-500 leading-6">
          Use your email and password to unlock the protected
          EGA House workspaces.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* Email */}
        <div className="flex flex-col gap-2">
          <label htmlFor="email" className="text-[0.72rem] font-medium text-slate-400 tracking-wide">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            disabled={isPending}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@egawilldoit.online"
            className="h-12 w-full rounded-xl border border-white/10 bg-white/5 px-4 text-sm text-white placeholder:text-slate-600 outline-none transition-all focus:border-emerald-500/50 focus:bg-white/[0.08] focus:ring-2 focus:ring-emerald-500/15 disabled:opacity-40"
          />
        </div>

        {/* Password */}
        <div className="flex flex-col gap-2">
          <label htmlFor="password" className="text-[0.72rem] font-medium text-slate-400 tracking-wide">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            disabled={isPending}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            className="h-12 w-full rounded-xl border border-white/10 bg-white/5 px-4 text-sm text-white placeholder:text-slate-600 outline-none transition-all focus:border-emerald-500/50 focus:bg-white/[0.08] focus:ring-2 focus:ring-emerald-500/15 disabled:opacity-40"
          />
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-xs text-red-400 leading-5">
            {error}
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={isPending}
          className="mt-2 h-12 w-full rounded-xl bg-emerald-500 text-sm font-semibold tracking-wide text-black transition-all hover:bg-emerald-400 hover:shadow-[0_0_28px_rgba(34,197,94,0.35)] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
