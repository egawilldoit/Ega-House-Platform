import React from "react";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "muted" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
};

const variantClasses = {
  default: "btn-instrument",
  muted:   "btn-instrument btn-instrument-muted",
  ghost:   "border border-transparent bg-transparent text-[color:var(--muted-foreground)] hover:border-[var(--border)] hover:bg-[var(--secondary)] hover:text-[color:var(--foreground)]",
  danger:  "border border-[rgba(198,40,40,0.18)] bg-[rgba(198,40,40,0.05)] text-signal-error hover:bg-[rgba(198,40,40,0.1)]",
};

const sizeClasses = {
  sm: "h-8 px-3 text-xs",
  md: "h-9 px-4 text-sm",
  lg: "h-10 px-5 text-sm",
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
        "transition-precise disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]",
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
