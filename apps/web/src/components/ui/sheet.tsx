"use client";

import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useRef,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

type SheetContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

const SheetContext = createContext<SheetContextValue | null>(null);

function useSheetContext() {
  const context = useContext(SheetContext);

  if (!context) {
    throw new Error("Sheet components must be used within <Sheet>.");
  }

  return context;
}

type SheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
};

export function Sheet({ open, onOpenChange, children }: SheetProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onOpenChange(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onOpenChange]);

  return (
    <SheetContext.Provider value={{ open, setOpen: onOpenChange }}>
      {children}
    </SheetContext.Provider>
  );
}

type SheetTriggerProps = {
  asChild?: boolean;
  children: ReactNode;
};

export function SheetTrigger({ asChild = false, children }: SheetTriggerProps) {
  const { setOpen } = useSheetContext();

  if (asChild && isValidElement(children)) {
    const child = children as ReactElement<{ onClick?: () => void }>;
    return cloneElement(child, {
      onClick: () => {
        child.props.onClick?.();
        setOpen(true);
      },
    });
  }

  return (
    <button type="button" onClick={() => setOpen(true)}>
      {children}
    </button>
  );
}

type SheetContentProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  /** Accessible name for the backdrop control that closes the sheet. */
  closeLabel?: string;
};

const SHEET_FOCUSABLE_SELECTOR =
  "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

export function SheetContent({
  className,
  children,
  closeLabel = "Close panel",
  ...props
}: SheetContentProps) {
  const { open, setOpen } = useSheetContext();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const panel = panelRef.current;
    const target = panel?.querySelector<HTMLElement>(SHEET_FOCUSABLE_SELECTOR);
    (target ?? panel)?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab" || !panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(SHEET_FOCUSABLE_SELECTOR),
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[90]">
      <button
        type="button"
        aria-label={closeLabel}
        className="absolute inset-0 bg-[var(--ega-overlay)]"
        onClick={() => setOpen(false)}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={cn(
          "absolute inset-y-0 left-0 z-[91] flex w-full flex-col overflow-y-auto border-r border-[var(--ega-border)] bg-[var(--ega-surface)] shadow-[var(--ega-shadow-lg)] outline-none min-[761px]:left-[calc(var(--sidebar-width)-1px)] min-[761px]:max-w-xl",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function SheetHeader({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("space-y-2", className)} {...props} />;
}

export function SheetTitle({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn(
        "text-[length:var(--text-section)] font-semibold tracking-[var(--tracking-tight)] text-[color:var(--ega-text)]",
        className,
      )}
      {...props}
    >
      {children ?? <span className="sr-only">Sheet section</span>}
    </h2>
  );
}

export function SheetDescription({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn(
        "max-w-lg text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-[color:var(--ega-text-secondary)]",
        className,
      )}
      {...props}
    />
  );
}

export function SheetClose({ asChild = false, children }: SheetTriggerProps) {
  const { setOpen } = useSheetContext();

  if (asChild && isValidElement(children)) {
    const child = Children.only(children) as ReactElement<{ onClick?: () => void }>;
    return cloneElement(child, {
      onClick: () => {
        child.props.onClick?.();
        setOpen(false);
      },
    });
  }

  return (
    <button type="button" onClick={() => setOpen(false)}>
      {children}
    </button>
  );
}
