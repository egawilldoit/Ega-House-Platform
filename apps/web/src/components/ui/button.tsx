import React from "react";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "default" | "muted" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
};

const variantClasses = {
  primary: "btn-instrument",
  default: "btn-instrument",
  secondary: "btn-instrument btn-instrument-muted",
  muted: "btn-instrument btn-instrument-muted",
  ghost:
    "border border-transparent bg-transparent text-[color:var(--ega-text-secondary)] hover:border-[var(--ega-border)] hover:bg-[var(--ega-surface-hover)] hover:text-[color:var(--ega-text)]",
  danger:
    "border border-[var(--status-overdue-border)] bg-[var(--status-overdue-bg)] text-[color:var(--status-overdue)] hover:border-[color:var(--status-overdue)]",
};

const sizeClasses = {
  sm: "h-7 px-2.5 text-xs",
  md: "h-8 px-3 text-sm",
  lg: "h-9 px-3.5 text-sm",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = "primary",
    size = "md",
    type = "button",
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        variantClasses[variant],
        sizeClasses[size],
        "rounded-[var(--radius-sm)] font-medium transition-[background-color,border-color,color] duration-[var(--duration-fast)] disabled:cursor-not-allowed disabled:opacity-40",
        className,
      )}
      {...props}
    />
  );
});

/* Export buttonVariants for compatibility with existing code referencing it */
export function buttonVariants({ variant = "primary", size = "md" }: { variant?: ButtonProps["variant"]; size?: ButtonProps["size"] } = {}) {
  return cn(variantClasses[variant ?? "primary"], sizeClasses[size ?? "md"]);
}
