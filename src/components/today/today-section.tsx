import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type TodaySectionProps = {
  title: string;
  count: number;
  children: ReactNode;
  emptyState: ReactNode;
  headerActions?: ReactNode;
  tone?: "muted" | "info" | "warn" | "success";
  compactWhenEmpty?: boolean;
};

export function TodaySection({
  title,
  count,
  children,
  emptyState,
  headerActions,
  tone = "muted",
  compactWhenEmpty = false,
}: TodaySectionProps) {
  const isEmpty = count === 0;

  return (
    <Card className="border-[var(--border)] bg-white">
      <CardHeader className={isEmpty && compactWhenEmpty ? "pb-3" : "pb-4"}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CardTitle className="text-lg">{title}</CardTitle>
            <Badge tone={tone}>{count}</Badge>
          </div>
          {headerActions}
        </div>
      </CardHeader>
      <CardContent className={isEmpty && compactWhenEmpty ? "pt-0" : "space-y-3 pt-0"}>
        {isEmpty ? emptyState : children}
      </CardContent>
    </Card>
  );
}
