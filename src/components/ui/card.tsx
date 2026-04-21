import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

type CardProps = HTMLAttributes<HTMLDivElement> & {
  label?: string;
  title?: string;
  action?: ReactNode;
};

export function Card({
  label,
  title,
  action,
  className,
  children,
  ...props
}: CardProps) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] border border-[var(--border)] bg-white text-[color:var(--foreground)] shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-card-hover)]",
        className,
      )}
      {...props}
    >
      {(label || title || action) && (
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              {label ? <div className="sidebar-section-label" style={{ padding: 0 }}>{label}</div> : null}
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

export function CardHeader({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-2 p-6", className)} {...props} />;
}

export function CardTitle({
  className,
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        "text-xl font-semibold tracking-tight text-[color:var(--foreground)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardDescription({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn(
        "text-sm leading-6 text-[color:var(--muted-foreground)]",
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
  return <div className={cn("p-6 pt-0", className)} {...props} />;
}

export function CardFooter({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 border-t border-[var(--border)] px-6 py-4",
        className,
      )}
      {...props}
    />
  );
}
