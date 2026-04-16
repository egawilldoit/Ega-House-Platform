import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (session) redirect("/tasks");

  return (
    <AppShell
      eyebrow="EGA House · Operational Platform"
      title="Command Interface"
      description="Shared operational surface connecting tasks, goals, timer, and weekly reviews."
      actions={
        <Link href="/login" className="btn-instrument glass-label h-9 px-5 flex items-center gap-2">
          Authenticate →
        </Link>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        {[
          { label: "Surfaces", value: "05", sub: "Task · Goal · Timer · Review · Ops" },
          { label: "Design Rev", value: "v2", sub: "Instrument cockpit interface" },
          { label: "Data Layer", value: "Live", sub: "Supabase realtime backend" },
          { label: "Stack", value: "N15", sub: "Next.js 15 · React 19 · TW v4" },
        ].map((item) => (
          <div key={item.label} className="instrument-border bg-instrument rounded-sm px-5 py-5">
            <div className="glass-label text-etch mb-2">{item.label}</div>
            <p className="font-mono tabular text-3xl font-medium" style={{ color: "var(--foreground)" }}>{item.value}</p>
            <p className="glass-label text-etch mt-1.5">{item.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card label="Workspace" title="Platform surfaces">
          <div className="space-y-1">
            {[
              { href: "/tasks",     label: "Tasks",     desc: "Create & filter execution tasks" },
              { href: "/goals",     label: "Goals",     desc: "Track strategic objectives" },
              { href: "/timer",     label: "Timer",     desc: "Focus session tracking" },
              { href: "/review",    label: "Review",    desc: "Weekly reflection workflow" },
              { href: "/dashboard", label: "Dashboard", desc: "Operational snapshot view" },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center justify-between px-3 py-2.5 rounded-sm transition-precise"
                style={{ color: "var(--muted-foreground)" }}
              >
                <div>
                  <span className="text-sm font-medium" style={{ color: "var(--foreground)" }}>{item.label}</span>
                  <span className="glass-label text-etch ml-3">{item.desc}</span>
                </div>
                <span className="text-etch">→</span>
              </Link>
            ))}
          </div>
        </Card>

        <Card label="Design" title="Instrument design system">
          <div className="grid grid-cols-2 gap-2.5">
            {[
              { label: "Canvas",      desc: "#0a0b0f deep black" },
              { label: "Signal Live", desc: "22c55e emerald" },
              { label: "Typography",  desc: "Plus Jakarta + DM Mono" },
              { label: "Borders",     desc: "7% white opacity" },
              { label: "Glass Label", desc: "Mono uppercase 11px" },
              { label: "Animate",     desc: "150ms cubic-bezier" },
            ].map((item) => (
              <div key={item.label} className="instrument-border rounded-sm px-3 py-2.5">
                <p className="glass-label text-etch mb-0.5">{item.label}</p>
                <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>{item.desc}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
