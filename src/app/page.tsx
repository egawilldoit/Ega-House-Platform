import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/services/auth-service";

export default async function HomePage() {
  const user = await getCurrentUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <main className="min-h-dvh bg-[#080a0d] text-foreground overflow-hidden">
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute top-[-20%] left-[10%] h-[600px] w-[600px] rounded-full bg-[radial-gradient(circle,rgba(34,197,94,0.07)_0%,transparent_65%)]" />
        <div className="absolute bottom-[-10%] right-[-5%] h-[500px] w-[500px] rounded-full bg-[radial-gradient(circle,rgba(34,197,94,0.04)_0%,transparent_60%)]" />
        {/* Subtle grid */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
            backgroundSize: "72px 72px",
          }}
        />
        {/* Top-edge highlight */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 h-px w-[70%] bg-gradient-to-r from-transparent via-emerald-500/30 to-transparent" />
      </div>

      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-6xl flex-col justify-center px-6 py-16 sm:px-10 lg:px-12">
        <div className="grid gap-16 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:items-center">

          {/* Left column */}
          <section className="max-w-2xl">
            {/* Logo + badge row */}
            <div className="flex items-center gap-4 mb-10">
              <Image
                src="/logo.svg"
                alt="EGA House"
                width={48}
                height={48}
                priority
                className="h-10 w-10 rounded-xl object-contain"
              />
              <span
                className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-3 py-1 text-[0.65rem] font-mono uppercase tracking-[0.22em] text-emerald-400"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                EGA House · Operational Platform
              </span>
            </div>

            <h1
              className="text-[clamp(2.6rem,5.5vw,4rem)] font-semibold leading-[1.08] tracking-[-0.04em] text-white"
              style={{ fontFamily: "var(--font-display)" }}
            >
              One command surface
              <br />
              <span className="text-emerald-400">for planning, execution,</span>
              <br />
              focus, and review.
            </h1>

            <p className="mt-7 max-w-xl text-[0.95rem] leading-7 text-slate-400">
              EGA House keeps goals, tasks, timer sessions, and weekly reviews in
              one shared workspace so operators can move from strategy to
              execution without losing context.
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-4">
              <Link
                href="/login?next=%2Fdashboard"
                className="inline-flex h-10 items-center rounded-lg bg-emerald-500 px-5 text-xs font-semibold tracking-wide text-black transition-all hover:bg-emerald-400 hover:shadow-[0_0_20px_rgba(34,197,94,0.35)] active:scale-95"
              >
                Enter workspace →
              </Link>
              <span className="text-xs text-slate-500">
                Sign in to continue to your dashboard.
              </span>
            </div>

            {/* Separator */}
            <div className="mt-14 h-px w-full bg-gradient-to-r from-white/5 via-white/10 to-transparent" />

            {/* Footnote stats */}
            <div className="mt-6 flex gap-8 text-xs text-slate-500 font-mono">
              <span>Goals · Tasks · Timer · Review</span>
              <span className="text-slate-600">·</span>
              <span>Session-shared across subdomains</span>
            </div>
          </section>

          {/* Right column — feature cards */}
          <section className="flex flex-col gap-3 sm:grid sm:grid-cols-3 lg:flex lg:flex-col">
            {[
              {
                label: "Goals",
                value: "Plan",
                detail: "Strategic objectives and roadmap direction.",
                accent: "text-emerald-400",
                border: "border-emerald-500/15",
                bg: "bg-emerald-500/[0.04]",
              },
              {
                label: "Tasks",
                value: "Execute",
                detail: "Operational work tracking with active delivery context.",
                accent: "text-sky-400",
                border: "border-sky-500/15",
                bg: "bg-sky-500/[0.04]",
              },
              {
                label: "Review",
                value: "Reflect",
                detail: "Cadence loop for weekly insight and system correction.",
                accent: "text-violet-400",
                border: "border-violet-500/15",
                bg: "bg-violet-500/[0.04]",
              },
            ].map((item) => (
              <article
                key={item.label}
                className={`group rounded-xl border ${item.border} ${item.bg} px-5 py-5 transition-all duration-300 hover:border-opacity-40 hover:bg-opacity-[0.07]`}
              >
                <p className={`font-mono text-[0.62rem] uppercase tracking-[0.28em] ${item.accent} opacity-70`}>
                  {item.label}
                </p>
                <p className="mt-3 text-xl font-semibold tracking-tight text-white">
                  {item.value}
                </p>
                <p className="mt-2 text-[0.8rem] leading-6 text-slate-500">
                  {item.detail}
                </p>
              </article>
            ))}
          </section>
        </div>
      </div>
    </main>
  );
}
