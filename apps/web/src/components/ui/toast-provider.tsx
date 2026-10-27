"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToastTone = "neutral" | "success" | "error";

export type ToastAction = {
  label: string;
  /** Runs the action; the queue disables duplicate clicks while it is pending. */
  run: () => ToastActionResult | Promise<ToastActionResult> | void;
};

/**
 * What the action actually did. `conflict` is a real outcome for undo: the
 * server may reject an inverse because the row changed, and the toast must say
 * so instead of claiming success.
 */
export type ToastActionResult = "success" | "conflict" | "failure";

export type ToastInput = {
  message: string;
  tone?: ToastTone;
  durationMs?: number;
  action?: ToastAction;
};

type ToastRecord = ToastInput & {
  id: number;
  pending: boolean;
  /** Replaces the message after an action reports its real outcome. */
  outcome?: ToastActionResult;
};

type ToastQueue = {
  show: (input: ToastInput) => number;
  dismiss: (id: number) => void;
  toasts: readonly ToastRecord[];
};

const ToastContext = createContext<ToastQueue | null>(null);

export const TOAST_DEFAULT_DURATION_MS = 6000;
export const TOAST_MAX_VISIBLE = 3;

const OUTCOME_COPY: Record<ToastActionResult, string> = {
  success: "Done",
  conflict: "Could not undo — the item changed since. Reload to see the current state.",
  failure: "Could not undo. Nothing was changed.",
};

/**
 * Toast queue: at most three visible, newest last, bottom-centre.
 *
 * The provider owns only presentation and pending state. It never claims an
 * operation succeeded — the caller's action reports success/conflict/failure and
 * that outcome is what the user sees.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (input: ToastInput) => {
      const id = nextId.current++;
      const duration = input.durationMs ?? TOAST_DEFAULT_DURATION_MS;
      setToasts((current) => [...current, { ...input, id, pending: false }].slice(-TOAST_MAX_VISIBLE));
      const timer = setTimeout(() => dismiss(id), duration);
      timers.current.set(id, timer);
      return id;
    },
    [dismiss],
  );

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
    },
    [],
  );

  const runAction = useCallback(async (toast: ToastRecord) => {
    if (!toast.action) return;
    setToasts((current) =>
      current.map((entry) => (entry.id === toast.id ? { ...entry, pending: true } : entry)),
    );
    let outcome: ToastActionResult = "failure";
    try {
      outcome = (await toast.action.run()) ?? "success";
    } catch {
      outcome = "failure";
    }
    setToasts((current) =>
      current.map((entry) =>
        entry.id === toast.id
          ? { ...entry, pending: false, outcome, message: OUTCOME_COPY[outcome] }
          : entry,
      ),
    );
  }, []);

  const value = useMemo<ToastQueue>(() => ({ show, dismiss, toasts }), [show, dismiss, toasts]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="region"
        aria-label="Notifications"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === "error" ? "alert" : "status"}
            data-tone={toast.tone ?? "neutral"}
            className={cn(
              "pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-[var(--radius-md)] border px-3 py-2 text-sm shadow-[var(--ega-shadow-md)]",
              "bg-[var(--ega-surface-elevated)] text-[color:var(--ega-text)]",
              toast.tone === "error" && "border-[var(--status-overdue-border)]",
              toast.tone === "success" && "border-[var(--status-healthy-border)]",
              toast.tone !== "error" && toast.tone !== "success" && "border-[var(--ega-border)]",
            )}
          >
            <span className="min-w-0 flex-1">{toast.message}</span>
            {toast.action ? (
              <button
                type="button"
                disabled={toast.pending}
                onClick={() => void runAction(toast)}
                className="shrink-0 rounded-[var(--radius-sm)] px-2 py-1 text-xs font-medium text-[color:var(--ega-text)] underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
              >
                {toast.pending ? "Working…" : toast.action.label}
              </button>
            ) : null}
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => dismiss(toast.id)}
              className="shrink-0 rounded-[var(--radius-sm)] p-1 text-[color:var(--ega-text-tertiary)] hover:bg-[var(--ega-surface-hover)]"
            >
              <X aria-hidden="true" className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToastQueue(): ToastQueue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToastQueue must be used inside <ToastProvider>");
  }
  return context;
}

/** Read-only view for tests and for components that only render the count. */
export function useToasts(): readonly ToastRecord[] {
  return useToastQueue().toasts;
}
