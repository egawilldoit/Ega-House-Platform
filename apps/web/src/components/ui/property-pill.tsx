"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { MenuList, type MenuListItem } from "@/components/ui/menu-list";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type PropertyPillProps = {
  /** Visible property name, e.g. "Status". Also names the listbox. */
  label: string;
  /** Current value id, or null when unset. */
  value: string | null;
  items: MenuListItem[];
  onSelect: (item: MenuListItem) => void;
  /** Rendered value; defaults to the selected item's label. */
  displayValue?: ReactNode;
  /** Leading glyph, usually a status/priority icon. */
  icon?: ReactNode;
  disabled?: boolean;
  /** Accessible name for the trigger when `label` is hidden. */
  triggerLabel?: string;
  className?: string;
  contentClassName?: string;
};

/**
 * A property pill: a trigger that opens a listbox of options.
 *
 * The trigger advertises `aria-haspopup="listbox"` and `aria-expanded`; Radix
 * owns focus return to the trigger on close and Escape/outside-click
 * dismissal. Selecting an option closes the popover and reports the item.
 */
export function PropertyPill({
  label,
  value,
  items,
  onSelect,
  displayValue,
  icon,
  disabled = false,
  triggerLabel,
  className,
  contentClassName,
}: PropertyPillProps) {
  const [open, setOpen] = useState(false);
  const selected = items.find((item) => item.id === value) ?? null;
  const shown = displayValue ?? selected?.label ?? "—";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        disabled={disabled}
        aria-label={triggerLabel ?? `${label}: ${typeof shown === "string" ? shown : "unset"}`}
        aria-haspopup="listbox"
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--ega-border)] bg-[var(--ega-surface)] px-2",
          "text-xs text-[color:var(--ega-text-secondary)] transition-colors duration-[var(--duration-fast)]",
          "hover:border-[var(--ega-border-strong)] hover:text-[color:var(--ega-text)]",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ega-focus-outline)]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
      >
        {icon ? (
          <span aria-hidden="true" className="flex size-3.5 items-center justify-center">
            {icon}
          </span>
        ) : null}
        <span className="max-w-[10rem] truncate">{shown}</span>
        <ChevronDown aria-hidden="true" className="size-3 opacity-60" />
      </PopoverTrigger>
      <PopoverContent className={contentClassName}>
        <MenuList
          autoFocus
          label={label}
          items={items}
          value={value}
          onSelect={(item) => {
            onSelect(item);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
