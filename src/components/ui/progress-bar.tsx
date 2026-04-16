import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type ProgressBarProps = HTMLAttributes<HTMLDivElement> & {
  value: number; // 0-100
  max?: number;
  variant?: "green" | "cyan" | "neutral";
  size?: "sm" | "md";
};

const variants = {
  green:   "bg-[var(--accent-green)]",
  cyan:    "bg-[var(--accent-cyan)]",
  neutral: "bg-white/30",
};

const sizes = {
  sm: "h-1.5",
  md: "h-2",
};

export function ProgressBar({
  value,
  max = 100,
  variant = "green",
  size = "sm",
  className,
  ...props
}: ProgressBarProps) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));

  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      className={cn(
        "w-full rounded-full bg-white/[0.07] overflow-hidden",
        sizes[size],
        className,
      )}
      {...props}
    >
      <div
        className={cn("h-full rounded-full transition-all duration-500 ease-out", variants[variant])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
