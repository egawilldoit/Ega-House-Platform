"use client";

import { useFormStatus } from "react-dom";
import { ArrowDown, ArrowUp, Star } from "lucide-react";

import { cn } from "@/lib/utils";

type MoveButtonProps = {
  direction: "up" | "down";
  disabled: boolean;
  label: string;
};

export function MoveButton({ direction, disabled, label }: MoveButtonProps) {
  const { pending } = useFormStatus();
  const Icon = direction === "up" ? ArrowUp : ArrowDown;
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      aria-label={label}
      className={cn(
        "inline-flex h-7 w-7 min-h-[40px] min-w-[40px] items-center justify-center rounded-[var(--radius-xs)] text-[color:var(--ega-text-secondary)] transition-colors hover:bg-[var(--ega-surface-hover)] hover:text-[color:var(--ega-text)] focus-visible:shadow-[var(--ega-focus-ring)] disabled:opacity-40 disabled:hover:bg-transparent",
        pending && "opacity-60",
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  );
}

type RemoveButtonProps = {
  label: string;
};

export function RemoveButton({ label }: RemoveButtonProps) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      aria-label={label}
      className={cn(
        "inline-flex h-7 w-7 min-h-[40px] min-w-[40px] items-center justify-center rounded-[var(--radius-xs)] text-[color:var(--ega-data-orange)] transition-colors hover:outline hover:outline-2 hover:outline-[var(--ega-data-orange)] focus-visible:shadow-[var(--ega-focus-ring)]",
        pending && "opacity-60",
      )}
    >
      <Star className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
    </button>
  );
}
