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
    <div
      className="w-full rounded-2xl p-10 backdrop-blur-xl"
      style={{
        border: "1px solid rgba(51,92,103,0.2)",
        background: "rgba(255,255,255,0.55)",
        boxShadow: "0 8px 60px rgba(84,11,14,0.12), 0 2px 16px rgba(51,92,103,0.08)",
      }}
    >
      {/* Header */}
      <div className="mb-9">
        <p
          className="font-mono text-[0.62rem] uppercase tracking-[0.3em] mb-3"
          style={{ color: "#9e2a2b", opacity: 0.7 }}
        >
          Login
        </p>
        <p className="text-xl font-semibold tracking-tight leading-tight" style={{ color: "#335c67" }}>
          Sign in to continue
        </p>
        <p className="mt-2 text-sm leading-6" style={{ color: "#540b0e", opacity: 0.65 }}>
          Use your email and password to unlock the protected EGA House workspaces.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* Email */}
        <div className="flex flex-col gap-2">
          <label
            htmlFor="email"
            className="text-[0.72rem] font-medium tracking-wide"
            style={{ color: "#335c67" }}
          >
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
            className="h-12 w-full rounded-xl px-4 text-sm outline-none transition-all disabled:opacity-40"
            style={{
              border: "1px solid rgba(51,92,103,0.25)",
              background: "rgba(255,255,255,0.6)",
              color: "#335c67",
            }}
            onFocus={(e) => {
              e.currentTarget.style.border = "1px solid rgba(224,159,62,0.6)";
              e.currentTarget.style.boxShadow = "0 0 0 3px rgba(224,159,62,0.15)";
            }}
            onBlur={(e) => {
              e.currentTarget.style.border = "1px solid rgba(51,92,103,0.25)";
              e.currentTarget.style.boxShadow = "none";
            }}
          />
        </div>

        {/* Password */}
        <div className="flex flex-col gap-2">
          <label
            htmlFor="password"
            className="text-[0.72rem] font-medium tracking-wide"
            style={{ color: "#335c67" }}
          >
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
            className="h-12 w-full rounded-xl px-4 text-sm outline-none transition-all disabled:opacity-40"
            style={{
              border: "1px solid rgba(51,92,103,0.25)",
              background: "rgba(255,255,255,0.6)",
              color: "#335c67",
            }}
            onFocus={(e) => {
              e.currentTarget.style.border = "1px solid rgba(224,159,62,0.6)";
              e.currentTarget.style.boxShadow = "0 0 0 3px rgba(224,159,62,0.15)";
            }}
            onBlur={(e) => {
              e.currentTarget.style.border = "1px solid rgba(51,92,103,0.25)";
              e.currentTarget.style.boxShadow = "none";
            }}
          />
        </div>

        {/* Error */}
        {error && (
          <div
            className="rounded-xl px-4 py-3 text-xs leading-5"
            style={{
              border: "1px solid rgba(158,42,43,0.3)",
              background: "rgba(158,42,43,0.08)",
              color: "#9e2a2b",
            }}
          >
            {error}
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={isPending}
          className="mt-2 h-12 w-full rounded-xl text-sm font-semibold tracking-wide transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            background: "#335c67",
            color: "#fff3b0",
          }}
          onMouseEnter={(e) => {
            if (!isPending) {
              (e.currentTarget as HTMLButtonElement).style.background = "#9e2a2b";
              (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 0 28px rgba(158,42,43,0.3)";
            }
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "#335c67";
            (e.currentTarget as HTMLButtonElement).style.boxShadow = "none";
          }}
        >
          {isPending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
