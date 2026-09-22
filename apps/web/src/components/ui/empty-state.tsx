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
        "flex flex-col items-center gap-2 px-5 py-8 text-center",
        className,
      )}
    >
      <Icon className="h-4 w-4 text-[color:var(--ega-text-tertiary)]" aria-hidden="true" />
      <p className="text-[length:var(--text-body)] font-medium text-[color:var(--ega-text)]">
        {title}
      </p>
      <p className="max-w-[48ch] text-[length:var(--text-meta-lg)] leading-[var(--leading-snug)] text-[color:var(--ega-text-secondary)]">
        {description}
      </p>
      {action ? <div className="mt-1">{action}</div> : null}
      {actionLabel && actionHref ? (
        <Link
          href={actionHref}
          className="btn-instrument btn-instrument-muted mt-1 flex h-8 items-center px-3 text-xs"
        >
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}
