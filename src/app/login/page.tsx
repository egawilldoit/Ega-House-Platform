import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Login",
  description: "Sign in to access your EGA House workspace.",
};

function LoginFormFallback() {
  return (
    <div className="w-full rounded-2xl border border-white/10 bg-white/[0.03] p-10 backdrop-blur">
      <div className="h-4 w-20 animate-pulse rounded-full bg-white/10" />
      <div className="mt-8 h-12 animate-pulse rounded-xl bg-white/10" />
      <div className="mt-3 h-12 animate-pulse rounded-xl bg-white/10" />
      <div className="mt-6 h-12 animate-pulse rounded-xl bg-white/10" />
    </div>
  );
}

export default async function LoginPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <main className="relative flex min-h-screen overflow-hidden bg-[#070809] text-white">
      {/* ── Ambient background ── */}
      <div className="pointer-events-none absolute inset-0 z-0">
        <div className="absolute -top-[20%] -left-[8%] h-[80vw] max-h-[900px] w-[80vw] max-w-[900px] rounded-full bg-[radial-gradient(circle,rgba(34,197,94,0.08)_0%,transparent_60%)]" />
        <div className="absolute bottom-[-10%] right-[35%] h-[50vw] max-h-[600px] w-[50vw] max-w-[600px] rounded-full bg-[radial-gradient(circle,rgba(99,102,241,0.05)_0%,transparent_60%)]" />
        <div
          className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,1) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,1) 1px,transparent 1px)",
            backgroundSize: "80px 80px",
          }}
        />
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-emerald-500/25 to-transparent" />
      </div>

      <div className="relative z-10 flex w-full flex-col justify-between gap-12 px-8 py-12 sm:px-14 lg:flex-row lg:items-center lg:px-20 xl:px-28">

        {/* ── Left ── */}
        <section className="max-w-2xl pt-4 lg:pt-0">
          {/* Logo + badge */}
          <div className="flex items-center gap-4 mb-12">
            <Image
              src="/logo.svg"
              alt="EGA House"
              width={56}
              height={56}
              priority
              className="h-12 w-12 rounded-2xl object-contain ring-1 ring-white/10"
            />
            <span className="inline-flex items-center gap-2.5 rounded-full border border-white/12 bg-white/5 px-4 py-1.5 font-mono text-[0.65rem] uppercase tracking-[0.24em] text-slate-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(34,197,94,0.8)] animate-pulse" />
              Root Domain Access
            </span>
          </div>

          {/* Heading */}
          <h1
            className="text-[clamp(3.4rem,6vw,6rem)] font-bold leading-[1.02] tracking-[-0.05em] text-white"
          >
            Enter control
            <br />
            <span className="text-emerald-400">room.</span>
          </h1>

          <p className="mt-7 max-w-lg text-[1.02rem] leading-8 text-slate-400">
            Sign in once on root domain, then continue into dashboard, goals,
            tasks, timer, and review with existing shared-session flow.
          </p>

          {/* Feature cards */}
          <div className="mt-12 grid max-w-xl gap-4 sm:grid-cols-3">
            {[
              {
                label: "Dashboard",
                text: "Operational snapshot after successful sign in.",
                accent: "border-emerald-500/15 text-emerald-400",
                glow: "rgba(34,197,94,0.05)",
              },
              {
                label: "Tasks",
                text: "Execution boards and structured delivery.",
                accent: "border-sky-500/15 text-sky-400",
                glow: "rgba(56,189,248,0.05)",
              },
              {
                label: "Review",
                text: "Reflection loops and operating cadence.",
                accent: "border-violet-500/15 text-violet-400",
                glow: "rgba(167,139,250,0.05)",
              },
            ].map((c) => {
              const [borderClass, textClass] = c.accent.split(" ");
              return (
                <div
                  key={c.label}
                  className={`rounded-2xl border ${borderClass} p-5`}
                  style={{ background: `radial-gradient(ellipse at top left, ${c.glow}, transparent 70%), rgba(255,255,255,0.02)` }}
                >
                  <p className={`font-mono text-[0.62rem] uppercase tracking-[0.28em] ${textClass}`}>
                    {c.label}
                  </p>
                  <p className="mt-3 text-[0.82rem] leading-5 text-slate-500">{c.text}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Right — form ── */}
        <section className="w-full max-w-md self-center lg:self-auto xl:max-w-[440px] shrink-0">
          <div className="relative">
            {/* Card glow rim */}
            <div className="absolute -inset-px rounded-2xl bg-gradient-to-b from-emerald-500/12 via-transparent to-transparent pointer-events-none" />
            <Suspense fallback={<LoginFormFallback />}>
              <LoginForm />
            </Suspense>
          </div>
        </section>
      </div>
    </main>
  );
}
