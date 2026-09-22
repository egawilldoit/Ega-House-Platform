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
  description?: string;
};

/** Secondary Today lane: a titled panel with a count and its rows. */
export function TodaySection({
  title,
  count,
  children,
  emptyState,
  headerActions,
  tone = "muted",
  compactWhenEmpty = false,
  description,
}: TodaySectionProps) {
  const isEmpty = count === 0;

  return (
    <Card>
      <CardHeader className={isEmpty && compactWhenEmpty ? "!py-3" : undefined}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <CardTitle className="truncate">{title}</CardTitle>
            <Badge tone={tone}>{count}</Badge>
          </div>
          {headerActions}
        </div>
        {description ? (
          <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            {description}
          </p>
        ) : null}
      </CardHeader>
      <CardContent
        className={
          isEmpty
            ? "!py-0"
            : "!px-0 !py-0"
        }
      >
        {isEmpty ? emptyState : children}
      </CardContent>
    </Card>
  );
}
