import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  actionHref,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "surface-empty flex flex-col items-center gap-3 px-5 py-6 text-center",
        className,
      )}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border)] bg-[color:var(--instrument)]">
        <Icon className="h-4 w-4 text-[color:var(--muted-foreground)]" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-[color:var(--foreground)]">{title}</p>
        <p className="text-sm leading-6 text-[color:var(--muted-foreground)]">{description}</p>
      </div>
      {action ? action : null}
      {actionLabel && actionHref ? (
        <Link href={actionHref} className="btn-instrument btn-instrument-muted flex h-8 items-center px-3 text-xs">
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}
