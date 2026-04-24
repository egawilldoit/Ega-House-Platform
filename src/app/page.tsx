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
    <main className="min-h-dvh bg-[radial-gradient(ellipse_90%_120%_at_50%_-10%,rgba(34,197,94,0.1),transparent_55%),linear-gradient(180deg,#0a0b0f_0%,#0d1016_100%)] text-foreground">
      <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col justify-center px-6 py-16 sm:px-10 lg:px-12">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-end">
          <section className="max-w-3xl">
            <Image
              src="/logo.svg"
              alt="EGA House"
              width={72}
              height={72}
              priority
              className="mb-6 h-16 w-16 rounded-2xl object-contain"
            />
            <p className="glass-label text-signal-live">EGA House · Operational Platform</p>
            <h1
              className="mt-5 max-w-3xl text-5xl font-semibold tracking-tight sm:text-6xl"
              style={{ fontFamily: "var(--font-display)" }}
            >
              One command surface for planning, execution, focus, and review.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-muted-foreground sm:text-lg">
              EGA House keeps goals, tasks, timer sessions, and weekly reviews in
              one shared workspace so operators can move from strategy to
              execution without losing context.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/login?next=%2Fdashboard"
                className="btn-instrument h-10 px-5 text-xs"
              >
                Login
              </Link>
              <p className="text-sm text-etch">
                Continue to your workspace after sign in.
              </p>
            </div>
          </section>

          <section className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
            {[
              {
                label: "Goals",
                value: "Plan",
                detail: "Strategic objectives and roadmap direction.",
              },
              {
                label: "Tasks",
                value: "Execute",
                detail: "Operational work tracking with active delivery context.",
              },
              {
                label: "Review",
                value: "Reflect",
                detail: "Cadence loop for weekly insight and system correction.",
              },
            ].map((item) => (
              <article
                key={item.label}
                className="instrument-border bg-instrument rounded-sm px-5 py-5"
              >
                <p className="glass-label text-etch">{item.label}</p>
                <p className="mt-3 text-2xl font-medium tabular">{item.value}</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
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
