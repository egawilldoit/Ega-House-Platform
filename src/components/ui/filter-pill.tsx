import Link from "next/link";
import { Check } from "lucide-react";
import type { MouseEventHandler } from "react";

import { cn } from "@/lib/utils";

type FilterPillProps = {
  href?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  label: string;
  active?: boolean;
  ariaCurrent?: "page";
  disabled?: boolean;
};

export function FilterPill({
  href,
  onClick,
  label,
  active = false,
  ariaCurrent,
  disabled = false,
}: FilterPillProps) {
  const classes = cn(
    "filter-pill",
    active && "filter-pill-active",
    disabled && "pointer-events-none opacity-50",
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-current={ariaCurrent}
        aria-pressed={active}
        className={classes}
      >
        {active ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
        <span>{label}</span>
      </button>
    );
  }

  return (
    <Link
      href={href ?? "#"}
      aria-current={ariaCurrent}
      className={cn(
        "filter-pill",
        active && "filter-pill-active",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      {active ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
      <span>{label}</span>
    </Link>
  );
}
