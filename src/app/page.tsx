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
    <main className="min-h-dvh bg-[#070809] text-foreground overflow-hidden">
      {/* ── Ambient background ── */}
      <div className="pointer-events-none fixed inset-0 z-0">
        {/* Large top-left bloom */}
        <div className="absolute -top-[20%] -left-[8%] h-[80vw] max-h-[900px] w-[80vw] max-w-[900px] rounded-full bg-[radial-gradient(circle,rgba(34,197,94,0.09)_0%,transparent_60%)]" />
        {/* Bottom-right accent */}
        <div className="absolute bottom-[-15%] right-[-5%] h-[50vw] max-h-[600px] w-[50vw] max-w-[600px] rounded-full bg-[radial-gradient(circle,rgba(34,197,94,0.05)_0%,transparent_60%)]" />
        {/* Grid */}
        <div
          className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,1) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,1) 1px,transparent 1px)",
            backgroundSize: "80px 80px",
          }}
        />
        {/* Top rule */}
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-emerald-500/25 to-transparent" />
      </div>

      {/* ── Content ── */}
      <div className="relative z-10 flex min-h-dvh w-full flex-col justify-center px-8 py-20 sm:px-14 lg:px-20 xl:px-28">
        <div className="grid w-full gap-12 lg:grid-cols-[1fr_420px] lg:items-center xl:grid-cols-[1fr_480px] xl:gap-20">

          {/* ── Left ── */}
          <section>
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
              <span className="inline-flex items-center gap-2.5 rounded-full border border-emerald-500/25 bg-emerald-500/8 px-4 py-1.5 text-[0.68rem] font-mono uppercase tracking-[0.24em] text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(34,197,94,0.8)] animate-pulse" />
                EGA House · Operational Platform
              </span>
            </div>

            {/* Hero heading */}
            <h1
              className="text-[clamp(3.2rem,6vw,5.5rem)] font-bold leading-[1.04] tracking-[-0.05em] text-white"
              style={{ fontFamily: "var(--font-display)" }}
            >
              One command
              <br />
              <span className="text-emerald-400">surface for planning,</span>
              <br />
              <span className="text-emerald-400">execution,</span> focus,
              <br />
              and review.
            </h1>

            {/* Body */}
            <p className="mt-8 max-w-2xl text-[1.05rem] leading-8 text-slate-400">
              EGA House keeps goals, tasks, timer sessions, and weekly reviews in
              one shared workspace so operators can move from strategy to
              execution without losing context.
            </p>

            {/* CTA */}
            <div className="mt-12 flex flex-wrap items-center gap-5">
              <Link
                href="/login?next=%2Fdashboard"
                className="inline-flex h-12 items-center gap-2 rounded-xl bg-emerald-500 px-7 text-sm font-semibold tracking-wide text-black transition-all hover:bg-emerald-400 hover:shadow-[0_0_28px_rgba(34,197,94,0.4)] active:scale-[0.97]"
              >
                Enter workspace
                <span className="opacity-70">→</span>
              </Link>
              <span className="text-sm text-slate-500">
                Sign in to continue to your dashboard.
              </span>
            </div>

            {/* Divider + footnote */}
            <div className="mt-16 h-px w-full max-w-2xl bg-gradient-to-r from-white/8 via-white/12 to-transparent" />
            <div className="mt-5 flex gap-6 text-[0.72rem] text-slate-600 font-mono tracking-wide">
              <span>Goals · Tasks · Timer · Review</span>
              <span className="text-slate-700">·</span>
              <span>Session-shared across subdomains</span>
            </div>
          </section>

          {/* ── Right — feature cards ── */}
          <section className="flex flex-col gap-4">
            {[
              {
                label: "Goals",
                value: "Plan",
                detail: "Strategic objectives and roadmap direction.",
                accent: "text-emerald-400",
                glow: "rgba(34,197,94,0.06)",
                border: "border-emerald-500/15",
              },
              {
                label: "Tasks",
                value: "Execute",
                detail: "Operational work tracking with active delivery context.",
                accent: "text-sky-400",
                glow: "rgba(56,189,248,0.06)",
                border: "border-sky-500/15",
              },
              {
                label: "Review",
                value: "Reflect",
                detail: "Cadence loop for weekly insight and system correction.",
                accent: "text-violet-400",
                glow: "rgba(167,139,250,0.06)",
                border: "border-violet-500/15",
              },
            ].map((item) => (
              <article
                key={item.label}
                className={`rounded-2xl border ${item.border} px-7 py-6 transition-all duration-300 hover:brightness-110`}
                style={{ background: `radial-gradient(ellipse at top left, ${item.glow}, transparent 70%), rgba(255,255,255,0.02)` }}
              >
                <p className={`font-mono text-[0.65rem] uppercase tracking-[0.3em] ${item.accent} opacity-75`}>
                  {item.label}
                </p>
                <p className="mt-4 text-2xl font-semibold tracking-tight text-white">
                  {item.value}
                </p>
                <p className="mt-2 text-[0.85rem] leading-6 text-slate-500">
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
