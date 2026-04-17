"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";

type WorkspaceErrorFallbackProps = {
  reset: () => void;
  scopeLabel: string;
  homeHref?: `/${string}`;
};

const WORKSPACE_LINKS: Array<{ href: `/${string}`; label: string }> = [
  { href: "/tasks", label: "Tasks" },
  { href: "/goals", label: "Goals" },
  { href: "/timer", label: "Timer" },
  { href: "/review", label: "Review" },
];

export function WorkspaceErrorFallback({
  reset,
  scopeLabel,
  homeHref = "/",
}: WorkspaceErrorFallbackProps) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-6 py-12">
      <div className="pointer-events-none absolute inset-0 opacity-20 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-[var(--signal-live)] via-transparent to-transparent" />
      <section className="relative z-10 w-full max-w-3xl rounded-[1.75rem] border border-[var(--border)] bg-[color:var(--instrument)] p-10 text-center shadow-sm">
        <div className="mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-full bg-[rgba(239,68,68,0.12)]">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-[rgba(239,68,68,0.28)] text-3xl font-semibold text-[var(--signal-error)]">
            !
          </div>
        </div>

        <p className="glass-label text-etch">{scopeLabel}</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-[color:var(--foreground)] sm:text-5xl">
          Workspace Disconnected
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-[color:var(--muted-foreground)] sm:text-base">
          Unable to retrieve the current workspace payload from the primary node.
          Retry the connection or switch to another stable surface.
        </p>

        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Button onClick={reset} className="min-w-44">
            Retry Connection
          </Button>
          <Link
            href={homeHref}
            className="btn-instrument btn-instrument-muted flex min-w-44 items-center justify-center"
          >
            Go to Home
          </Link>
        </div>

        <div className="mt-12 border-t border-[var(--border)] pt-8 text-left">
          <div className="glass-label text-etch mb-5 px-1">Recovery Options</div>
          <nav aria-label="Workspace navigation" className="grid gap-4 sm:grid-cols-2">
            {WORKSPACE_LINKS.map((workspace) => (
              <Link
                key={workspace.href}
                href={workspace.href}
                className="group flex items-start gap-4 rounded-sm border border-[var(--border)] bg-[color:var(--instrument-raised)] p-4 transition hover:border-[var(--border-strong)]"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-sm bg-[rgba(34,197,94,0.08)] text-lg font-semibold text-[var(--signal-live)] transition group-hover:bg-[var(--signal-live)] group-hover:text-black">
                  {"›"}
                </div>
                <div>
                  <div className="text-sm font-semibold text-[color:var(--foreground)]">
                    {workspace.label}
                  </div>
                  <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                    Open {workspace.label.toLowerCase()} workspace
                  </div>
                </div>
              </Link>
            ))}
          </nav>
        </div>

        <div className="mt-8 flex justify-center">
          <div className="inline-flex items-center gap-2 rounded-sm border border-[var(--border)] bg-[color:var(--instrument-raised)] px-3 py-2 text-[10px] font-medium uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
            <span className="h-2 w-2 rounded-full bg-[var(--signal-error)]" />
            ERR_CODE: TSK-503-ND
          </div>
        </div>
      </section>
    </main>
  );
}
