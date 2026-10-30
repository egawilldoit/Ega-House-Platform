import Link from "next/link";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type StatCardProps = {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
  subtitle?: ReactNode;
  trend?: ReactNode;
  variant?: "default" | "green" | "cyan" | "muted";
  className?: string;
  /**
   * When present the whole card becomes a link to a filtered destination. The
   * caller must pass `linkLabel` so the link has one explicit accessible name
   * instead of an ambiguous concatenation of its visible parts.
   */
  href?: string;
  linkLabel?: string;
  "data-testid"?: string;
};

const CARD_CLASSES =
  "flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--ega-border)] bg-[color:var(--ega-surface)] px-[18px] py-4";

const INTERACTIVE_CLASSES =
  "transition-colors hover:border-[var(--ega-border-strong)] hover:bg-[color:var(--ega-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ega-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--ega-bg)]";

/**
 * KPI card used across dashboards.
 *
 * Variants are intentionally neutral: data categories come from charts, not
 * from tinted card backgrounds. With `href` the entire card is one link, so the
 * click target matches the visual card and keyboard focus is unambiguous.
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  subtitle,
  trend,
  variant = "default",
  className,
  href,
  linkLabel,
  "data-testid": testId,
}: StatCardProps) {
  const content = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[length:var(--text-meta-lg)] font-medium text-[color:var(--ega-text-secondary)]">
          {label}
        </p>
        {Icon ? (
          <Icon className="h-4 w-4 shrink-0 text-[color:var(--ega-text-tertiary)]" aria-hidden="true" />
        ) : null}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <p className="text-[length:var(--text-metric)] font-semibold leading-none tracking-[var(--tracking-tight)] tabular-nums text-[color:var(--ega-text)]">
          {value}
        </p>
        {trend ? <span className="text-[length:var(--text-meta)]">{trend}</span> : null}
      </div>
      {subtitle ? (
        <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
          {subtitle}
        </p>
      ) : null}
    </>
  );

  const classes = cn(
    CARD_CLASSES,
    variant === "muted" && "bg-[color:var(--ega-surface-subtle)]",
    href && INTERACTIVE_CLASSES,
    className,
  );

  if (href) {
    return (
      <Link href={href} className={classes} aria-label={linkLabel} data-testid={testId}>
        {content}
      </Link>
    );
  }

  return (
    <div className={classes} data-testid={testId}>
      {content}
    </div>
  );
}
