import Link from "next/link";

import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function ReviewDetailNotFound() {
  return (
    <AppShell
      title="Review not found"
      description="The selected review could not be located."
    >
      <Card>
        <CardHeader>
          <CardTitle>Missing review</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-ega-text-secondary">
            This review entry does not exist or was removed.
          </p>
          <Link
            href="/review"
            className="btn-instrument btn-instrument-muted inline-flex h-8 items-center justify-center px-3 text-[length:var(--text-meta-lg)] self-start"
          >
            Back to review workspace
          </Link>
        </CardContent>
      </Card>
    </AppShell>
  );
}
