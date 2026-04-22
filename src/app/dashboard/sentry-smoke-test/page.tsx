import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";

import { SentrySmokeTestTrigger } from "./sentry-smoke-test-trigger";

export const metadata: Metadata = {
  title: "Sentry Smoke Test | EGA House",
  description: "Temporary Sentry smoke test route for intentional error verification.",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function SentrySmokeTestPage() {
  return (
    <AppShell
      eyebrow="Temporary Verification"
      title="Sentry Smoke Test"
      description="Temporary route. Trigger one intentional error to verify event ingestion, then remove this page."
    >
      <div className="space-y-3 rounded-[1rem] border border-[var(--border)] bg-white p-4">
        <p className="text-sm text-[color:var(--muted-foreground)]">
          This route is intentionally unlinked and temporary.
        </p>
        <SentrySmokeTestTrigger />
      </div>
    </AppShell>
  );
}
