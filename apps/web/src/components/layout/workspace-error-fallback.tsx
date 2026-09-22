"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type WorkspaceErrorFallbackProps = {
  reset: () => void;
  scopeLabel: string;
  homeHref?: `/${string}`;
};

const WORKSPACE_LINKS: Array<{ href: `/${string}`; label: string; description: string }> = [
  { href: "/today", label: "Today", description: "Today's plan and active work" },
  { href: "/tasks", label: "Tasks", description: "The full task inventory" },
  { href: "/goals", label: "Goals", description: "Goals and their projects" },
  { href: "/review", label: "Review", description: "The weekly review loop" },
];

/**
 * Shared route error surface.
 *
 * It is deliberately independent of the workspace shell so it can render even
 * when the shell's own data reads are the thing that failed.
 */
export function WorkspaceErrorFallback({
  reset,
  scopeLabel,
  homeHref = "/home",
}: WorkspaceErrorFallbackProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--ega-bg)] px-6 py-12">
      <section className="w-full max-w-xl" aria-labelledby="workspace-error-title">
        <Card>
          <CardContent className="flex flex-col gap-4">
            <p className="glass-label">{scopeLabel}</p>
            <div>
              <h1
                id="workspace-error-title"
                className="text-[length:var(--text-page)] font-semibold tracking-[var(--tracking-tight)] text-[color:var(--ega-text)]"
              >
                This screen could not load
              </h1>
              <p className="mt-2 text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-[color:var(--ega-text-secondary)]">
                The data for this surface did not come back. Retrying is safe — nothing was
                changed, and no partially saved work was kept.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={reset}>Try again</Button>
              <Link
                href={homeHref}
                className="btn-instrument btn-instrument-muted flex h-8 items-center px-3 text-sm"
              >
                Go to Home
              </Link>
            </div>

            <div className="border-t border-[var(--ega-divider)] pt-4">
              <p className="glass-label">Other surfaces</p>
              <ul className="mt-2 flex flex-col">
                {WORKSPACE_LINKS.map((workspace) => (
                  <li key={workspace.href}>
                    <Link href={workspace.href} className="row row-link">
                      <span className="row-main">
                        <span className="row-title">{workspace.label}</span>
                        <span className="row-meta">{workspace.description}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
