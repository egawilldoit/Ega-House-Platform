"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

type PopoverContextValue = { open: boolean; setOpen: (v: boolean) => void };
const PopoverContext = createContext<PopoverContextValue | null>(null);

function usePopover() {
  const ctx = useContext(PopoverContext);
  if (!ctx) throw new Error("Popover components must be inside <Popover>");
  return ctx;
}

type PopoverProps = { open?: boolean; onOpenChange?: (o: boolean) => void; children: ReactNode };
export function Popover({ open: controlledOpen, onOpenChange, children }: PopoverProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (v: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(v);
    onOpenChange?.(v);
  };
  return <PopoverContext.Provider value={{ open, setOpen }}>{children}</PopoverContext.Provider>;
}

export function PopoverTrigger({ children, asChild: _asChild, className, ...props }: { children: ReactNode; asChild?: boolean; className?: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { open, setOpen } = usePopover();
  return (
    <button type="button" aria-expanded={open} aria-haspopup="dialog" className={className} onClick={() => setOpen(!open)} {...props}>
      {children}
    </button>
  );
}

export function PopoverContent({ children, className, align = "end" }: { children: ReactNode; className?: string; align?: "start" | "end" | "center" }) {
  const { open, setOpen } = usePopover();
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
  }, [open, setOpen]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div ref={ref} role="dialog" className={cn("fixed z-50 min-w-[12rem] rounded-[var(--radius-md)] border border-[var(--ega-border)] bg-[var(--ega-surface)] p-1 shadow-[var(--ega-shadow-lg)]", align === "end" && "right-4", className)} style={{ top: "auto" }}>
      {children}
    </div>,
    document.body,
  );
}
