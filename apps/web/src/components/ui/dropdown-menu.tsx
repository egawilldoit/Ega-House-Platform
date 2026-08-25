"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

type DropdownMenuProps = {
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "end";
};

export function DropdownMenu({ trigger, children, align = "end" }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative inline-flex">
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="inline-flex items-center justify-center">
        {trigger}
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div role="menu" className={cn("fixed z-50 min-w-[12rem] rounded-[var(--radius-md)] border border-[var(--ega-border)] bg-[var(--ega-surface)] p-1 shadow-[var(--ega-shadow-lg)]", align === "end" ? "right-0" : "left-0")} style={{ position: "absolute", top: ref.current ? ref.current.getBoundingClientRect().bottom + 4 + window.scrollY : 0, left: align === "end" && ref.current ? ref.current.getBoundingClientRect().right - 192 + window.scrollX : ref.current ? ref.current.getBoundingClientRect().left + window.scrollX : 0 }}>
              <div className="flex flex-col gap-0.5" onClick={() => setOpen(false)}>
                {children}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export function DropdownMenuItem({ children, onSelect, disabled, className, ...props }: { children: ReactNode; onSelect?: () => void; disabled?: boolean; className?: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => onSelect?.()}
      className={cn("flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-sm text-[var(--ega-text)] hover:bg-[var(--ega-surface-hover)] disabled:opacity-40", className)}
      {...props}
    >
      {children}
    </button>
  );
}

export function DropdownMenuSeparator({ className }: { className?: string }) {
  return <div className={cn("my-1 h-px bg-[var(--ega-border)]", className)} />;
}
