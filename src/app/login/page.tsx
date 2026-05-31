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
    <div
      className="w-full rounded-2xl p-10 backdrop-blur"
      style={{ border: "1px solid rgba(51,92,103,0.2)", background: "rgba(255,255,255,0.5)" }}
    >
      <div className="h-4 w-20 animate-pulse rounded-full" style={{ background: "rgba(51,92,103,0.15)" }} />
      <div className="mt-8 h-12 animate-pulse rounded-xl" style={{ background: "rgba(51,92,103,0.1)" }} />
      <div className="mt-3 h-12 animate-pulse rounded-xl" style={{ background: "rgba(51,92,103,0.1)" }} />
      <div className="mt-6 h-12 animate-pulse rounded-xl" style={{ background: "rgba(51,92,103,0.1)" }} />
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
    <main className="relative flex min-h-screen overflow-hidden flex-col" style={{ background: "#fff3b0" }}>
      {/* ── Ambient background ── */}
      <div className="pointer-events-none absolute inset-0 z-0">
        <div
          className="absolute -top-[20%] -left-[8%] h-[80vw] max-h-[900px] w-[80vw] max-w-[900px] rounded-full"
          style={{ background: "radial-gradient(circle, rgba(51,92,103,0.12) 0%, transparent 60%)" }}
        />
        <div
          className="absolute bottom-[-10%] right-[30%] h-[50vw] max-h-[600px] w-[50vw] max-w-[600px] rounded-full"
          style={{ background: "radial-gradient(circle, rgba(158,42,43,0.09) 0%, transparent 60%)" }}
        />
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(51,92,103,0.8) 1px,transparent 1px),linear-gradient(90deg,rgba(51,92,103,0.8) 1px,transparent 1px)",
            backgroundSize: "80px 80px",
          }}
        />
        <div
          className="absolute top-0 left-0 right-0 h-px"
          style={{ background: "linear-gradient(90deg, transparent, rgba(224,159,62,0.5), transparent)" }}
        />
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
              className="h-12 w-12 rounded-2xl object-contain"
              style={{ boxShadow: "0 2px 16px rgba(84,11,14,0.15)" }}
            />
            <span
              className="inline-flex items-center gap-2.5 rounded-full px-4 py-1.5 font-mono text-[0.65rem] uppercase tracking-[0.24em]"
              style={{
                border: "1px solid rgba(51,92,103,0.3)",
                background: "rgba(51,92,103,0.08)",
                color: "#335c67",
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full animate-pulse"
                style={{ background: "#e09f3e", boxShadow: "0 0 6px rgba(224,159,62,0.9)" }}
              />
              Root Domain Access
            </span>
          </div>

          {/* Heading */}
          <h1
            className="text-[clamp(3.4rem,6vw,6rem)] font-bold leading-[1.02] tracking-[-0.05em]"
            style={{ color: "#335c67" }}
          >
            Enter control
            <br />
            <span style={{ color: "#9e2a2b" }}>room.</span>
          </h1>

          <p
            className="mt-7 max-w-lg text-[1.02rem] leading-8"
            style={{ color: "#540b0e" }}
          >
            Sign in once on root domain, then continue into dashboard, goals,
            tasks, timer, and review with existing shared-session flow.
          </p>

          {/* Feature cards */}
          <div className="mt-12 grid max-w-xl gap-4 sm:grid-cols-3">
            {[
              {
                label: "Dashboard",
                text: "Operational snapshot after successful sign in.",
                accent: "#335c67",
                borderColor: "rgba(51,92,103,0.25)",
                glow: "rgba(51,92,103,0.06)",
              },
              {
                label: "Tasks",
                text: "Execution boards and structured delivery.",
                accent: "#9e2a2b",
                borderColor: "rgba(158,42,43,0.25)",
                glow: "rgba(158,42,43,0.06)",
              },
              {
                label: "Review",
                text: "Reflection loops and operating cadence.",
                accent: "#540b0e",
                borderColor: "rgba(84,11,14,0.2)",
                glow: "rgba(84,11,14,0.05)",
              },
            ].map((c) => (
              <div
                key={c.label}
                className="rounded-2xl p-5"
                style={{
                  border: `1px solid ${c.borderColor}`,
                  background: `radial-gradient(ellipse at top left, ${c.glow}, transparent 70%), rgba(255,255,255,0.45)`,
                  backdropFilter: "blur(8px)",
                }}
              >
                <p
                  className="font-mono text-[0.62rem] uppercase tracking-[0.28em]"
                  style={{ color: c.accent }}
                >
                  {c.label}
                </p>
                <p className="mt-3 text-[0.82rem] leading-5" style={{ color: "#540b0e", opacity: 0.7 }}>
                  {c.text}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Right — form ── */}
        <section className="w-full max-w-lg self-center lg:self-auto xl:max-w-[520px] shrink-0">
          <div className="relative">
            <div
              className="absolute -inset-px rounded-2xl pointer-events-none"
              style={{ background: "linear-gradient(to bottom, rgba(224,159,62,0.2), transparent)" }}
            />
            <Suspense fallback={<LoginFormFallback />}>
              <LoginForm />
            </Suspense>
          </div>
        </section>
      </div>

      {/* ── TRUST STRIP ── */}
      <div
        className="relative z-10 mx-8 mb-12 sm:mx-14 lg:mx-20 xl:mx-28 rounded-2xl px-8 py-8"
        style={{
          border: "1px solid rgba(51,92,103,0.15)",
          background: "rgba(255,255,255,0.35)",
          backdropFilter: "blur(8px)",
        }}
      >
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          {[
            { icon: "🔒", label: "Secure by default", desc: "Supabase auth with server-side session validation on every request." },
            { icon: "⚡", label: "Single sign-on", desc: "Log in once on root domain. Session flows across all subdomains automatically." },
            { icon: "🎯", label: "Built for operators", desc: "Not a generic tool. Designed around the Plan → Execute → Reflect loop." },
          ].map((item) => (
            <div key={item.label} className="flex gap-4 items-start">
              <span className="text-2xl">{item.icon}</span>
              <div>
                <p className="font-semibold text-sm" style={{ color: "#335c67" }}>{item.label}</p>
                <p className="mt-1 text-xs leading-5" style={{ color: "#540b0e", opacity: 0.65 }}>{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
