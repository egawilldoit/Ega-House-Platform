import type { Metadata } from "next";
import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AppShell } from "@/components/layout/app-shell";

export const metadata: Metadata = {
  title: "Not found",
};

export default function NotFound() {
  return (
    <AppShell>
      <Card>
        <CardHeader>
          <CardTitle>Page not found</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-ega-text-secondary">
            This route does not exist or was removed. Head back to the workspace home,
            or open search to find what you need.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/home"
              className="btn-instrument inline-flex h-8 items-center justify-center px-3 text-[length:var(--text-meta-lg)]"
            >
              Back to Home
            </Link>
            <Link
              href="/today"
              className="btn-instrument btn-instrument-muted inline-flex h-8 items-center justify-center px-3 text-[length:var(--text-meta-lg)]"
            >
              Today
            </Link>
            <Link
              href="/tasks"
              className="btn-instrument btn-instrument-muted inline-flex h-8 items-center justify-center px-3 text-[length:var(--text-meta-lg)]"
            >
              Tasks
            </Link>
          </div>
        </CardContent>
      </Card>
    </AppShell>
  );
}
