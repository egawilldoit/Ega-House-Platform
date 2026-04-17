import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Login | EGA House",
  description: "Sign in to access your EGA House workspace.",
};

function LoginFormFallback() {
  return (
    <div className="w-full max-w-md rounded-[2rem] border border-black/10 bg-white/80 p-8 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur">
      <div className="h-5 w-28 animate-pulse rounded-full bg-black/10" />
      <div className="mt-6 h-12 animate-pulse rounded-2xl bg-black/10" />
      <div className="mt-4 h-12 animate-pulse rounded-2xl bg-black/10" />
      <div className="mt-6 h-12 animate-pulse rounded-full bg-black/10" />
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
    <main className="relative flex min-h-screen overflow-hidden bg-[linear-gradient(135deg,#f7f1e8_0%,#efe6d6_38%,#d8e0dd_100%)] text-slate-950">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-10%] top-[-12%] h-[28rem] w-[28rem] rounded-full bg-[radial-gradient(circle_at_center,rgba(184,115,51,0.26),transparent_68%)] blur-3xl" />
        <div className="absolute bottom-[-16%] right-[-8%] h-[32rem] w-[32rem] rounded-full bg-[radial-gradient(circle_at_center,rgba(33,110,91,0.16),transparent_65%)] blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(15,23,42,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.04)_1px,transparent_1px)] bg-[size:3.5rem_3.5rem] opacity-35" />
      </div>

      <div className="relative mx-auto flex w-full max-w-6xl flex-col justify-between gap-10 px-6 py-8 sm:px-10 lg:flex-row lg:items-center lg:px-12">
        <section className="max-w-2xl pt-6 lg:pt-0">
          <p className="inline-flex items-center rounded-full border border-black/10 bg-white/50 px-4 py-2 font-mono text-[0.68rem] uppercase tracking-[0.32em] text-slate-600 backdrop-blur">
            Root Domain Access
          </p>
          <h1 className="mt-8 max-w-xl text-5xl font-semibold tracking-[-0.08em] text-balance sm:text-6xl lg:text-7xl">
            Enter control room.
          </h1>
          <p className="mt-6 max-w-lg text-base leading-8 text-slate-700 sm:text-lg">
            Sign in once on root domain, then continue into dashboard, goals,
            tasks, timer, and review with existing shared-session flow.
          </p>
          <div className="mt-10 grid max-w-xl gap-4 sm:grid-cols-3">
            <div className="rounded-[1.5rem] border border-black/10 bg-white/60 p-4 backdrop-blur">
              <p className="font-mono text-[0.68rem] uppercase tracking-[0.28em] text-slate-500">
                Dashboard
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-700">
                Operational snapshot after successful sign in.
              </p>
            </div>
            <div className="rounded-[1.5rem] border border-black/10 bg-white/60 p-4 backdrop-blur">
              <p className="font-mono text-[0.68rem] uppercase tracking-[0.28em] text-slate-500">
                Tasks
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-700">
                Execution boards and structured delivery.
              </p>
            </div>
            <div className="rounded-[1.5rem] border border-black/10 bg-white/60 p-4 backdrop-blur">
              <p className="font-mono text-[0.68rem] uppercase tracking-[0.28em] text-slate-500">
                Review
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-700">
                Reflection loops and operating cadence.
              </p>
            </div>
          </div>
        </section>

        <section className="relative w-full max-w-md self-center lg:self-auto">
          <Suspense fallback={<LoginFormFallback />}>
            <LoginForm />
          </Suspense>
        </section>
      </div>
    </main>
  );
}
