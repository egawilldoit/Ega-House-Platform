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
        <CardContent className="space-y-4">
          <p className="text-sm leading-7 text-slate-300">
            This review entry does not exist or was removed.
          </p>
          <Link
            href="/review"
            className="inline-flex min-h-10 items-center justify-center rounded-full border border-white/15 bg-white/8 px-4 text-sm font-medium text-slate-100 transition duration-200 hover:border-cyan-300/40 hover:bg-cyan-300/10"
          >
            Back to review workspace
          </Link>
        </CardContent>
      </Card>
    </AppShell>
  );
}
