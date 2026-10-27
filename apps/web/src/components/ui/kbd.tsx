import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * A keycap for documenting shortcuts (`⌘`, `K`, `Esc`).
 *
 * Presentational only: the surrounding control owns the shortcut behaviour and
 * must expose it through `aria-keyshortcuts` when the shortcut is actionable.
 */
export function Kbd({ className, children, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] border border-[var(--ega-border)] bg-[var(--ega-surface-muted)] px-1",
        "font-mono text-[10px] leading-none text-[color:var(--ega-text-secondary)]",
        className,
      )}
      {...props}
    >
      {children}
    </kbd>
  );
}
