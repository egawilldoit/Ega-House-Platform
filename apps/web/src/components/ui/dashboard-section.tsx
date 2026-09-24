import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type DashboardSectionProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

/**
 * Dashboard-level section: a heading row followed by a content grid.
 *
 * Home, Analytics, and Review compose with this so section rhythm stays
 * identical across the product.
 */
export function DashboardSection({
  title,
  description,
  actions,
  children,
  className,
}: DashboardSectionProps) {
  return (
    <section className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[length:var(--text-section)] font-semibold tracking-[var(--tracking-tight)] text-[color:var(--ega-text)]">
            {title}
          </h2>
          {description ? (
            <p className="mt-1 max-w-[80ch] text-[length:var(--text-body)] leading-[var(--leading-snug)] text-[color:var(--ega-text-secondary)]">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {children}
    </section>
  );
}
