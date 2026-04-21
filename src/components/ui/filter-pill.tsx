import Link from "next/link";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

type FilterPillProps = {
  href: string;
  label: string;
  active?: boolean;
  ariaCurrent?: "page";
};

export function FilterPill({
  href,
  label,
  active = false,
  ariaCurrent,
}: FilterPillProps) {
  return (
    <Link
      href={href}
      aria-current={ariaCurrent}
      className={cn("filter-pill", active && "filter-pill-active")}
    >
      {active ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
      <span>{label}</span>
    </Link>
  );
}

