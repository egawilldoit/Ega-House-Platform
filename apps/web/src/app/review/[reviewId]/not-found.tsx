import Link from "next/link";

import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function ReviewDetailNotFound() {
  return (
    <AppShell
      eyebrow="Review Workspace"
      title="Review not found"
      description="The selected review could not be located."
      navigation={
        <>
          <Badge tone="warn">Missing record</Badge>
        </>
      }
    >
      <Card>
        <CardHeader>
          <CardTitle>Missing review</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-1">
          <p className="text-sm leading-7 text-[color:var(--muted-foreground)]">
            This review entry does not exist or was removed.
          </p>
          <Link
            href="/review"
            className="btn-instrument btn-instrument-muted inline-flex min-h-10 items-center justify-center px-4 text-sm"
          >
            Back to review workspace
          </Link>
        </CardContent>
      </Card>
    </AppShell>
  );
}
