"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  TASK_PRIORITY_KEY_MAP,
  TASK_PRIORITY_SEQUENCE,
  TASK_STATUS_KEY_MAP,
  canHandleCharacterShortcut,
  readCharacterShortcutsEnabled,
} from "@/lib/keyboard-shortcuts";
import { SHORTCUT_SEQUENCE_TIMEOUT_MS } from "@/lib/keyboard-shortcuts";
import type { TaskDrawerDetail } from "@/lib/services/task-service";
import { formatTaskToken } from "@/lib/task-domain";
import type { TaskFieldDraftAction } from "./task-drawer-host";

type TaskDrawerShortcutsProps = {
  task: TaskDrawerDetail;
  action: TaskFieldDraftAction;
  ownerId: string | null;
  /** Reports the last keyboard action so the drawer can show what happened. */
  onMessage?: (message: string | null) => void;
};

/**
 * Character shortcuts scoped to the open task drawer.
 *
 * Status: 1 todo, 2 in progress, 3 review, 4 done, 5 blocked.
 * Priority: p then 1 low, 2 medium, 3 high, 4 urgent.
 *
 * The mapping is explicit (never derived from array order) and honours the
 * owner's character-shortcut preference. Editable controls, IME composition and
 * modifier combos are ignored, and blocked is refused without a reason rather
 * than failing server validation silently.
 */
export function TaskDrawerShortcuts({
  task,
  action,
  ownerId,
  onMessage,
}: TaskDrawerShortcutsProps) {
  const router = useRouter();
  const [enabled] = useState(() =>
    typeof window === "undefined"
      ? true
      : readCharacterShortcutsEnabled(window.localStorage, ownerId),
  );
  const prioritySequenceRef = useRef<number | null>(null);
  const pendingRef = useRef(false);

  useEffect(() => {
    const clearSequence = () => {
      if (prioritySequenceRef.current !== null) {
        window.clearTimeout(prioritySequenceRef.current);
        prioritySequenceRef.current = null;
      }
    };

    const apply = async (field: "status" | "priority", value: string, label: string) => {
      if (pendingRef.current) return;
      pendingRef.current = true;
      try {
        const formData = new FormData();
        formData.set("taskId", task.id);
        formData.set("field", field);
        formData.set("value", value);
        const result = await action(
          { errorMessage: null, successMessage: null, savedValue: null },
          formData,
        );
        onMessage?.(result.errorMessage ?? `${label} set to ${formatTaskToken(value)}.`);
        if (!result.errorMessage) router.refresh();
      } catch {
        onMessage?.("Unable to save right now. Try again.");
      } finally {
        pendingRef.current = false;
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!canHandleCharacterShortcut(event, enabled)) return;

      const key = event.key.toLowerCase();
      if (prioritySequenceRef.current !== null) {
        const priority = TASK_PRIORITY_KEY_MAP[key as keyof typeof TASK_PRIORITY_KEY_MAP];
        clearSequence();
        if (priority) {
          event.preventDefault();
          if (priority !== task.priority) void apply("priority", priority, "Priority");
        }
        return;
      }

      if (key === TASK_PRIORITY_SEQUENCE) {
        event.preventDefault();
        prioritySequenceRef.current = window.setTimeout(clearSequence, SHORTCUT_SEQUENCE_TIMEOUT_MS);
        onMessage?.("Press 1 low, 2 medium, 3 high or 4 urgent.");
        return;
      }

      const status = TASK_STATUS_KEY_MAP[key as keyof typeof TASK_STATUS_KEY_MAP];
      if (!status) return;
      event.preventDefault();
      if (status === task.status) return;
      if (status === "blocked" && !task.blocked_reason) {
        onMessage?.("Add a blocked reason in the property grid first.");
        return;
      }
      void apply("status", status, "Status");
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      clearSequence();
    };
  }, [action, enabled, onMessage, router, task.blocked_reason, task.id, task.priority, task.status]);

  if (!enabled) return null;

  return (
    <p className="mt-3 text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
      Keys: 1 todo · 2 in progress · 3 review · 4 done · 5 blocked · p then 1–4 priority.
    </p>
  );
}
