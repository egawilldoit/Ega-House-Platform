import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

/* ── InstrumentCard ─────────────────────────────────────── */
type InstrumentCardProps = HTMLAttributes<HTMLDivElement> & {
  label?: string;
  title?: string;
  action?: ReactNode;
};

export function InstrumentCard({
  label,
  title,
  action,
  className,
  children,
  ...props
}: InstrumentCardProps) {
  return (
    <div
      className={cn(
        "instrument-border bg-instrument rounded-sm p-6",
        className,
      )}
      {...props}
    >
      {(label || title || action) && (
        <div className="flex items-start justify-between mb-5">
          <div>
            {label && (
              <div className="glass-label text-etch mb-1.5">{label}</div>
            )}
            {title && (
              <h3
                className="font-medium tracking-tight"
                style={{ color: "var(--foreground)" }}
              >
                {title}
              </h3>
            )}
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

/* ── Convenience sub-components (Card-compat API) ────────── */
export function InstrumentCardHeader({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("px-6 pt-6 pb-5", className)} {...props} />
  );
}

export function InstrumentCardTitle({
  className,
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn("font-medium tracking-tight text-base", className)}
      style={{ color: "var(--foreground)", fontFamily: "var(--font-display)" }}
      {...props}
    />
  );
}

export function InstrumentCardDescription({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn("text-xs mt-0.5 leading-relaxed", className)}
      style={{ color: "var(--muted-foreground)" }}
      {...props}
    />
  );
}

export function InstrumentCardContent({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("px-6 pb-6", className)} {...props} />
  );
}

export function InstrumentCardFooter({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 border-t px-6 py-4",
        className,
      )}
      style={{ borderColor: "var(--border)" }}
      {...props}
    />
  );
}

/* Re-export as "Card" aliases to keep page code compatible */
export { InstrumentCard as Card };
export { InstrumentCardHeader as CardHeader };
export { InstrumentCardTitle as CardTitle };
export { InstrumentCardDescription as CardDescription };
export { InstrumentCardContent as CardContent };
export { InstrumentCardFooter as CardFooter };
