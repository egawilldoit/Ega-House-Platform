"use client";

import {
  createContext,
  useContext,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

type TabsContextValue = {
  value: string;
  onValueChange: (value: string) => void;
};

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext() {
  const context = useContext(TabsContext);

  if (!context) {
    throw new Error("Tabs components must be used within <Tabs>.");
  }

  return context;
}

type TabsProps = {
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
  className?: string;
};

export function Tabs({ value, onValueChange, children, className }: TabsProps) {
  return (
    <TabsContext.Provider value={{ value, onValueChange }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-2 rounded-[1rem] border border-[var(--border)] bg-[color:var(--instrument)] p-1",
        className,
      )}
      {...props}
    />
  );
}

type TabsTriggerProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  value: string;
};

export function TabsTrigger({
  className,
  value,
  children,
  ...props
}: TabsTriggerProps) {
  const { value: activeValue, onValueChange } = useTabsContext();
  const isActive = value === activeValue;

  return (
    <button
      type="button"
      className={cn(
        "rounded-[0.8rem] px-3 py-2 text-sm font-medium transition-precise focus-visible:outline-none",
        isActive
          ? "bg-white text-[color:var(--foreground)] shadow-[0_6px_18px_rgba(20,32,19,0.08)]"
          : "text-[color:var(--muted-foreground)] hover:bg-white/70 hover:text-[color:var(--foreground)]",
        className,
      )}
      onClick={() => onValueChange(value)}
      {...props}
    >
      {children}
    </button>
  );
}

type TabsContentProps = HTMLAttributes<HTMLDivElement> & {
  value: string;
};

export function TabsContent({
  className,
  value,
  children,
  ...props
}: TabsContentProps) {
  const { value: activeValue } = useTabsContext();

  if (value !== activeValue) {
    return null;
  }

  return (
    <div className={className} {...props}>
      {children}
    </div>
  );
}
