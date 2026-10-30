"use client";

import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Right-click menus for rows and kanban cards. Same visual contract as
 * `dropdown-menu.tsx`; Radix owns the open-at-pointer positioning, focus and
 * Escape handling.
 */
export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;
export const ContextMenuGroup = ContextMenuPrimitive.Group;

export const ContextMenuSeparator = forwardRef<
  ElementRef<typeof ContextMenuPrimitive.Separator>,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(function ContextMenuSeparator({ className, ...props }, ref) {
  return (
    <ContextMenuPrimitive.Separator
      ref={ref}
      className={cn("my-1 h-px bg-[var(--ega-divider)]", className)}
      {...props}
    />
  );
});

export const ContextMenuContent = forwardRef<
  ElementRef<typeof ContextMenuPrimitive.Content>,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(function ContextMenuContent({ className, ...props }, ref) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        ref={ref}
        collisionPadding={8}
        className={cn(
          "z-50 min-w-[12rem] rounded-[var(--radius-md)] border border-[var(--ega-border)]",
          "bg-[var(--ega-surface-elevated)] p-1 text-sm text-[color:var(--ega-text)] shadow-[var(--ega-shadow-md)]",
          "focus:outline-none",
          className,
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  );
});

export const ContextMenuItem = forwardRef<
  ElementRef<typeof ContextMenuPrimitive.Item>,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> & { tone?: "default" | "danger" }
>(function ContextMenuItem({ className, tone = "default", ...props }, ref) {
  return (
    <ContextMenuPrimitive.Item
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
