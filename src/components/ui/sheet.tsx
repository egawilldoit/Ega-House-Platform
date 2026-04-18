"use client";

import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useEffect,
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
};

export function SheetContent({
  className,
  children,
  ...props
}: SheetContentProps) {
  const { open, setOpen } = useSheetContext();

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[90]">
      <button
        type="button"
        aria-label="Close quick task panel"
        className="absolute inset-0 bg-[rgba(20,32,19,0.2)] backdrop-blur-[2px]"
        onClick={() => setOpen(false)}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "absolute inset-y-0 left-0 z-[91] w-full border-l border-[var(--border)] bg-[rgba(246,247,242,0.96)] shadow-[0_24px_64px_rgba(20,32,19,0.16)] backdrop-blur-xl sm:left-[calc(var(--sidebar-width)-1px)] sm:max-w-xl",
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
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn(
        "font-display text-[1.35rem] font-semibold tracking-[-0.03em] text-[color:var(--foreground)]",
        className,
      )}
      {...props}
    />
  );
}

export function SheetDescription({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn("max-w-lg text-sm leading-6 text-[color:var(--muted-foreground)]", className)}
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
