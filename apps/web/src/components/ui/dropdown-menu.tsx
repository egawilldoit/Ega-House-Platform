"use client";

import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Row/overflow menus. Radix owns type-ahead, roving focus, Escape and the
 * dismiss layers, so these wrappers only add the workspace surface tokens.
 */
export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;
export const DropdownMenuSeparator = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.Separator>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(function DropdownMenuSeparator({ className, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Separator
      ref={ref}
      className={cn("my-1 h-px bg-[var(--ega-divider)]", className)}
      {...props}
    />
  );
});

export const DropdownMenuContent = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(function DropdownMenuContent({ className, align = "end", sideOffset = 6, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          "z-50 min-w-[12rem] rounded-[var(--radius-md)] border border-[var(--ega-border)]",
          "bg-[var(--ega-surface-elevated)] p-1 text-sm text-[color:var(--ega-text)] shadow-[var(--ega-shadow-md)]",
          "focus:outline-none",
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
});

export const DropdownMenuItem = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.Item>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & { tone?: "default" | "danger" }
>(function DropdownMenuItem({ className, tone = "default", ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Item
      ref={ref}
      className={cn(
        "flex cursor-pointer select-none items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-sm outline-none",
        "data-[highlighted]:bg-[var(--ega-surface-hover)] data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
        tone === "danger"
          ? "text-[color:var(--status-overdue)]"
          : "text-[color:var(--ega-text-secondary)]",
        className,
      )}
      {...props}
    />
  );
});
