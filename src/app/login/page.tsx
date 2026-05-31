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
    <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.03] p-8 backdrop-blur">
      <div className="h-4 w-20 animate-pulse rounded-full bg-white/10" />
      <div className="mt-8 h-10 animate-pulse rounded-lg bg-white/10" />
      <div className="mt-3 h-10 animate-pulse rounded-lg bg-white/10" />
      <div className="mt-6 h-10 animate-pulse rounded-lg bg-white/10" />
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
    <main className="relative flex min-h-screen overflow-hidden bg-[#080a0d] text-white">
      {/* Ambient background — same language as home */}
      <div className="pointer-events-none absolute inset-0 z-0">
        <div className="absolute top-[-15%] left-[-5%] h-[550px] w-[550px] rounded-full bg-[radial-gradient(circle,rgba(34,197,94,0.06)_0%,transparent_65%)]" />
        <div className="absolute bottom-[-10%] right-[30%] h-[400px] w-[400px] rounded-full bg-[radial-gradient(circle,rgba(99,102,241,0.05)_0%,transparent_60%)]" />
        <div
          className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.8) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.8) 1px, transparent 1px)",
            backgroundSize: "72px 72px",
          }}
        />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 h-px w-[60%] bg-gradient-to-r from-transparent via-emerald-500/25 to-transparent" />
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col justify-between gap-12 px-6 py-10 sm:px-10 lg:flex-row lg:items-center lg:px-12">

        {/* Left — context */}
        <section className="max-w-xl pt-4 lg:pt-0">
          <div className="flex items-center gap-4 mb-10">
            <Image
              src="/logo.svg"
              alt="EGA House"
              width={44}
              height={44}
              priority
              className="h-10 w-10 rounded-xl object-contain"
            />
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono text-[0.62rem] uppercase tracking-[0.22em] text-slate-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Root Domain Access
            </span>
          </div>

          <h1
            className="text-[clamp(2.8rem,5vw,4.5rem)] font-semibold leading-[1.05] tracking-[-0.04em] text-white"
          >
            Enter control
            <br />
            <span className="text-emerald-400">room.</span>
          </h1>

          <p className="mt-6 max-w-md text-[0.92rem] leading-7 text-slate-400">
            Sign in once on root domain, then continue into dashboard, goals,
            tasks, timer, and review with existing shared-session flow.
          </p>

          {/* Feature hints */}
          <div className="mt-10 grid max-w-lg gap-3 sm:grid-cols-3">
            {[
              {
                label: "Dashboard",
                text: "Operational snapshot after successful sign in.",
                accent: "border-emerald-500/15 text-emerald-400",
              },
              {
                label: "Tasks",
                text: "Execution boards and structured delivery.",
                accent: "border-sky-500/15 text-sky-400",
              },
              {
                label: "Review",
                text: "Reflection loops and operating cadence.",
                accent: "border-violet-500/15 text-violet-400",
              },
            ].map((c) => (
              <div
                key={c.label}
                className={`rounded-xl border ${c.accent.split(" ")[0]} bg-white/[0.02] p-4`}
              >
                <p className={`font-mono text-[0.6rem] uppercase tracking-[0.26em] ${c.accent.split(" ")[1]}`}>
                  {c.label}
                </p>
                <p className="mt-2 text-[0.78rem] leading-5 text-slate-500">{c.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Right — form */}
        <section className="relative w-full max-w-sm self-center lg:self-auto">
          {/* Card glow */}
          <div className="absolute -inset-px rounded-2xl bg-gradient-to-b from-emerald-500/10 via-transparent to-transparent pointer-events-none" />
          <Suspense fallback={<LoginFormFallback />}>
            <LoginForm />
          </Suspense>
        </section>
      </div>
    </main>
  );
}
