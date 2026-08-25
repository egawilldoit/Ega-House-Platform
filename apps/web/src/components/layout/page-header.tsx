import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
};

export function PageHeader({ eyebrow, title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn("flex items-end justify-between gap-6", className)}>
      <div className="min-w-0">
        {eyebrow ? <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ega-text-tertiary)]">{eyebrow}</div> : null}
        <h1 tabIndex={-1} className="text-[var(--text-page)] font-bold tracking-[var(--tracking-tight)] text-[var(--ega-text)] focus:outline-none" style={{ lineHeight: "1.05" }}>
          {title}
        </h1>
        {description ? <p className="mt-3 max-w-2xl text-[var(--text-body-lg)] leading-7 text-[var(--ega-text-secondary)]">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div> : null}
    </div>
  );
}
