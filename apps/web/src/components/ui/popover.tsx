"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import type { ComponentPropsWithoutRef, ElementRef } from "react";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Popover built on Radix so focus management, dismissal (outside click,
 * Escape), collision-aware placement and `aria-expanded` wiring come from one
 * behaviour instead of per-feature reimplementations.
 *
 * Composed pickers live in `property-pill.tsx`; this file is only the shell.
 */
export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

export const PopoverContent = forwardRef<
  ElementRef<typeof PopoverPrimitive.Content>,
  ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(function PopoverContent(
  { className, align = "start", sideOffset = 6, role = "presentation", ...props },
  ref,
) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        role={role}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          "z-50 min-w-[12rem] max-w-[min(22rem,calc(100vw-1rem))] rounded-[var(--radius-md)] border border-[var(--ega-border)]",
          "bg-[var(--ega-surface-elevated)] p-1 text-sm text-[color:var(--ega-text)] shadow-[var(--ega-shadow-md)]",
          "focus:outline-none",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
});
