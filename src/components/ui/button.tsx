import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "muted" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
};

const variantClasses = {
  default: "btn-instrument",
  muted:   "btn-instrument btn-instrument-muted",
  ghost:   "border border-transparent bg-transparent text-etch hover:text-foreground hover:border-[var(--border)]",
  danger:  "border border-[rgba(239,68,68,0.4)] text-signal-error bg-transparent hover:bg-[rgba(239,68,68,0.08)]",
};

const sizeClasses = {
  sm: "h-7 px-3 text-[10px]",
  md: "h-8 px-4 text-[11px]",
  lg: "h-10 px-5 text-xs",
};

export function Button({
  className,
  variant = "default",
  size = "md",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        variantClasses[variant],
        sizeClasses[size],
        "transition-precise disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--signal-live)]",
        className,
      )}
      {...props}
    />
  );
}

/* Export buttonVariants for compatibility with existing code referencing it */
export function buttonVariants({ variant = "default", size = "md" }: { variant?: ButtonProps["variant"]; size?: ButtonProps["size"] } = {}) {
  return cn(variantClasses[variant ?? "default"], sizeClasses[size ?? "md"]);
}
