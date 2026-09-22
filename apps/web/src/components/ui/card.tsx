import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

type CardProps = HTMLAttributes<HTMLDivElement> & {
  label?: string;
  title?: string;
  action?: ReactNode;
  /**
   * Clips the panel contents to its radius. Off by default: a panel must never
   * clip a row-level disclosure menu that opens past its edge.
   */
  clip?: boolean;
};

/**
 * Default authenticated panel: white surface, 1px neutral border, no shadow.
 *
 * Static panels never gain hover elevation; only interactive overlays use
 * shadows in this system.
 */
export function Card({
  label,
  title,
  action,
  clip = false,
  className,
  children,
  ...props
}: CardProps) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-lg)] border border-[var(--ega-border)] bg-[color:var(--ega-surface)] text-[color:var(--ega-text)]",
        clip && "overflow-hidden",
        className,
      )}
      {...props}
    >
      {(label || title || action) && (
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-0.5">
              {label ? <PanelLabel>{label}</PanelLabel> : null}
              {title ? <CardTitle>{title}</CardTitle> : null}
            </div>
            {action ? <CardAction>{action}</CardAction> : null}
          </div>
        </CardHeader>
      )}
      {children}
    </div>
  );
}

export function PanelLabel({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "text-[length:var(--text-micro)] font-semibold uppercase tracking-[var(--tracking-widest)] text-[color:var(--ega-text-tertiary)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 border-b border-[var(--ega-divider)] px-[18px] py-4",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        "text-[length:var(--text-panel-title)] font-semibold tracking-[var(--tracking-tight)] text-[color:var(--ega-text)]",
        className,
      )}
      {...props}
    >
      {children ?? <span className="sr-only">Card section</span>}
    </h3>
  );
}

export function CardDescription({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn(
        "text-[length:var(--text-meta-lg)] leading-[var(--leading-snug)] text-[color:var(--ega-text-secondary)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardAction({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex shrink-0 items-center gap-2 self-start", className)}
      {...props}
    />
  );
}

export function CardContent({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-[18px] py-4", className)} {...props} />;
}

export function CardFooter({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 border-t border-[var(--ega-divider)] px-[18px] py-3",
        className,
      )}
      {...props}
    />
  );
}
