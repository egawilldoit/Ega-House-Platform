"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

type TooltipProps = {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  delayMs?: number;
  className?: string;
};

export function Tooltip({ content, children, side = "top", delayMs = 300, className }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<number | null>(null);

  const show = () => {
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        let x = rect.left + rect.width / 2;
        let y = rect.top;
        if (side === "bottom") y = rect.bottom;
        if (side === "left") { x = rect.left; y = rect.top + rect.height / 2; }
        if (side === "right") { x = rect.right; y = rect.top + rect.height / 2; }
        setCoords({ x, y });
      }
      setOpen(true);
    }, delayMs);
  };

  const hide = () => {
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    setOpen(false);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className="inline-flex"
      >
        {children}
      </div>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              role="tooltip"
              className={cn(
                "pointer-events-none fixed z-[100] max-w-xs rounded-md border border-[var(--ega-border)] bg-[var(--ega-sidebar)] px-2.5 py-1.5 text-xs font-medium leading-4 text-white shadow-[var(--ega-shadow-md)]",
                side === "top" && "-translate-x-1/2 -translate-y-full -mt-2",
                side === "bottom" && "-translate-x-1/2 mt-2",
                side === "left" && "-translate-x-full -translate-y-1/2 -ml-2",
                side === "right" && "-translate-y-1/2 ml-2",
                className,
              )}
              style={{ left: coords.x, top: coords.y }}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
