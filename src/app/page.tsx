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
    <main className="min-h-dvh overflow-hidden" style={{ background: "#fff3b0" }}>
      {/* ── Ambient background ── */}
      <div className="pointer-events-none fixed inset-0 z-0">
        {/* Top-left teal bloom */}
        <div
          className="absolute -top-[20%] -left-[8%] h-[80vw] max-h-[900px] w-[80vw] max-w-[900px] rounded-full"
          style={{ background: "radial-gradient(circle, rgba(51,92,103,0.12) 0%, transparent 60%)" }}
        />
        {/* Bottom-right red bloom */}
        <div
          className="absolute bottom-[-15%] right-[-5%] h-[50vw] max-h-[600px] w-[50vw] max-w-[600px] rounded-full"
          style={{ background: "radial-gradient(circle, rgba(158,42,43,0.10) 0%, transparent 60%)" }}
        />
        {/* Subtle grid */}
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(51,92,103,0.8) 1px,transparent 1px),linear-gradient(90deg,rgba(51,92,103,0.8) 1px,transparent 1px)",
            backgroundSize: "80px 80px",
          }}
        />
        {/* Top rule */}
        <div
          className="absolute top-0 left-0 right-0 h-px"
          style={{ background: "linear-gradient(90deg, transparent, rgba(224,159,62,0.5), transparent)" }}
        />
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
                className="h-12 w-12 rounded-2xl object-contain"
                style={{ boxShadow: "0 2px 16px rgba(84,11,14,0.15)" }}
              />
              <span
                className="inline-flex items-center gap-2.5 rounded-full px-4 py-1.5 font-mono text-[0.68rem] uppercase tracking-[0.24em]"
                style={{
                  border: "1px solid rgba(224,159,62,0.4)",
                  background: "rgba(224,159,62,0.15)",
                  color: "#9e2a2b",
                }}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full animate-pulse"
                  style={{ background: "#e09f3e", boxShadow: "0 0 6px rgba(224,159,62,0.9)" }}
                />
                EGA House · Operational Platform
              </span>
            </div>

            {/* Hero heading */}
            <h1
              className="text-[clamp(3.2rem,6vw,5.5rem)] font-bold leading-[1.04] tracking-[-0.05em]"
              style={{ fontFamily: "var(--font-display)", color: "#335c67" }}
            >
              One command
              <br />
              <span style={{ color: "#9e2a2b" }}>surface for planning,</span>
              <br />
              <span style={{ color: "#9e2a2b" }}>execution,</span>{" "}
              <span style={{ color: "#335c67" }}>focus,</span>
              <br />
              <span style={{ color: "#335c67" }}>and review.</span>
            </h1>

            {/* Body */}
            <p
              className="mt-8 max-w-2xl text-[1.05rem] leading-8"
              style={{ color: "#540b0e" }}
            >
              EGA House keeps goals, tasks, timer sessions, and weekly reviews in
              one shared workspace so operators can move from strategy to
              execution without losing context.
            </p>

            {/* CTA */}
            <div className="mt-12 flex flex-wrap items-center gap-4">
              <Link
                href="/login?next=%2Fdashboard"
                className="inline-flex h-12 items-center gap-2 rounded-xl px-7 text-sm font-semibold tracking-wide transition-all active:scale-[0.97] hover:bg-[#9e2a2b] hover:shadow-[0_0_28px_rgba(158,42,43,0.35)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#335c67]"
                style={{
                  background: "#335c67",
                  color: "#fff3b0",
                }}
              >
                Enter workspace
                <span className="opacity-70">→</span>
              </Link>
              <Link
                href="https://www.egawilldoit.online/signup"
                className="inline-flex h-12 items-center gap-2 rounded-xl border px-7 text-sm font-semibold tracking-wide transition-all active:scale-[0.97] hover:-translate-y-0.5 hover:bg-white/65 hover:shadow-[0_10px_30px_rgba(84,11,14,0.10)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#9e2a2b]"
                style={{
                  borderColor: "rgba(158,42,43,0.3)",
                  background: "rgba(255,255,255,0.38)",
                  color: "#9e2a2b",
                }}
              >
                Create account
                <span aria-hidden="true" className="opacity-70">↗</span>
              </Link>
              <span className="w-full text-sm sm:w-auto" style={{ color: "#9e2a2b" }}>
                Sign in or create your workspace to get started.
              </span>
            </div>

            {/* Divider + footnote */}
            <div
              className="mt-16 h-px w-full max-w-2xl"
              style={{ background: "linear-gradient(90deg, rgba(51,92,103,0.2), rgba(51,92,103,0.08), transparent)" }}
            />
            <div className="mt-5 flex gap-6 font-mono tracking-wide text-[0.72rem]" style={{ color: "#9e2a2b", opacity: 0.6 }}>
              <span>Goals · Tasks · Timer · Review</span>
              <span style={{ opacity: 0.4 }}>·</span>
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
                accent: "#335c67",
                borderColor: "rgba(51,92,103,0.25)",
                glowColor: "rgba(51,92,103,0.06)",
              },
              {
                label: "Tasks",
                value: "Execute",
                detail: "Operational work tracking with active delivery context.",
                accent: "#9e2a2b",
                borderColor: "rgba(158,42,43,0.25)",
                glowColor: "rgba(158,42,43,0.06)",
              },
              {
                label: "Review",
                value: "Reflect",
                detail: "Cadence loop for weekly insight and system correction.",
                accent: "#540b0e",
                borderColor: "rgba(84,11,14,0.2)",
                glowColor: "rgba(84,11,14,0.05)",
              },
            ].map((item) => (
              <article
                key={item.label}
                className="rounded-2xl px-7 py-6 transition-all duration-300"
                style={{
                  border: `1px solid ${item.borderColor}`,
                  background: `radial-gradient(ellipse at top left, ${item.glowColor}, transparent 70%), rgba(255,255,255,0.45)`,
                  backdropFilter: "blur(8px)",
                }}
              >
                <p
                  className="font-mono text-[0.65rem] uppercase tracking-[0.3em]"
                  style={{ color: item.accent, opacity: 0.8 }}
                >
                  {item.label}
                </p>
                <p
                  className="mt-4 text-2xl font-semibold tracking-tight"
                  style={{ color: "#335c67" }}
                >
                  {item.value}
                </p>
                <p
                  className="mt-2 text-[0.85rem] leading-6"
                  style={{ color: "#540b0e", opacity: 0.7 }}
                >
                  {item.detail}
                </p>
              </article>
            ))}
          </section>
        </div>

        {/* ── HOW IT WORKS ── */}
        <div className="mt-24 border-t border-b py-16" style={{ borderColor: "rgba(51,92,103,0.15)" }}>
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.3em] mb-10 text-center" style={{ color: "#9e2a2b", opacity: 0.7 }}>
            How it works
          </p>
          <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
            {[
              { step: "01", label: "Set your goals", desc: "Define strategic objectives and break them into actionable milestones." },
              { step: "02", label: "Plan your tasks", desc: "Create tasks linked to goals. Assign context, priority, and deadlines." },
              { step: "03", label: "Focus & execute", desc: "Run focused timer sessions tied directly to active tasks." },
              { step: "04", label: "Review & correct", desc: "Weekly reflection loops to close gaps and adjust your system." },
            ].map((item) => (
              <div key={item.step} className="flex flex-col">
                <span className="font-mono text-[2.5rem] font-bold leading-none" style={{ color: "#e09f3e", opacity: 0.35 }}>
                  {item.step}
                </span>
                <p className="mt-3 text-base font-semibold" style={{ color: "#335c67" }}>{item.label}</p>
                <p className="mt-2 text-sm leading-6" style={{ color: "#540b0e", opacity: 0.65 }}>{item.desc}</p>
              </div>
            ))}
          </div>

          <section
            className="mt-14 grid gap-8 rounded-3xl px-7 py-8 sm:px-10 lg:grid-cols-[1fr_auto] lg:items-center"
            style={{
              border: "1px solid rgba(51,92,103,0.2)",
              background: "radial-gradient(circle at top left, rgba(224,159,62,0.18), transparent 45%), rgba(255,255,255,0.52)",
              boxShadow: "0 24px 70px rgba(84,11,14,0.08)",
              backdropFilter: "blur(14px)",
            }}
            aria-labelledby="signup-cta-title"
          >
            <div>
              <p className="font-mono text-[0.65rem] uppercase tracking-[0.28em]" style={{ color: "#9e2a2b" }}>
                Ready to start?
              </p>
              <h2
                id="signup-cta-title"
                className="mt-3 text-2xl font-bold tracking-[-0.03em] sm:text-3xl"
                style={{ color: "#335c67" }}
              >
                Turn the workflow into your workspace.
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 sm:text-base" style={{ color: "#540b0e", opacity: 0.72 }}>
                Create your EGA House account and move from goals to focused execution in one place.
              </p>
            </div>

            <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center lg:flex-col lg:items-stretch">
              <Link
                href="https://www.egawilldoit.online/signup"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-xl px-6 text-sm font-semibold transition-all active:scale-[0.97] hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(51,92,103,0.22)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#335c67]"
                style={{ background: "#335c67", color: "#fff3b0" }}
              >
                Create your account
                <span aria-hidden="true">→</span>
              </Link>
              <Link
                href="/login?next=%2Fdashboard"
                className="inline-flex h-11 items-center justify-center rounded-xl px-5 text-sm font-semibold underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#9e2a2b]"
                style={{ color: "#9e2a2b" }}
              >
                Sign in instead
              </Link>
            </div>
          </section>
        </div>

        {/* ── STATS BAR ── */}
        <div className="mt-16 grid grid-cols-2 gap-6 lg:grid-cols-4">
          {[
            { value: "100%", label: "Session shared across subdomains" },
            { value: "4 modules", label: "Goals · Tasks · Timer · Review" },
            { value: "1 workspace", label: "Everything in one command surface" },
            { value: "Zero friction", label: "From strategy to execution instantly" },
          ].map((stat) => (
            <div
              key={stat.value}
              className="rounded-2xl px-6 py-6"
              style={{
                border: "1px solid rgba(51,92,103,0.18)",
                background: "rgba(255,255,255,0.4)",
                backdropFilter: "blur(8px)",
              }}
            >
              <p className="text-2xl font-bold tracking-tight" style={{ color: "#335c67" }}>{stat.value}</p>
              <p className="mt-1 text-xs leading-5" style={{ color: "#540b0e", opacity: 0.65 }}>{stat.label}</p>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
