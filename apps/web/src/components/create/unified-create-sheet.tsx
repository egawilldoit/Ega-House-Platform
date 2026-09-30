"use client";

import { useEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { QuickTaskSheetPanel } from "@/components/tasks/quick-task-sheet";
import { InboxCapturePanel } from "@/components/inbox/inbox-capture-sheet";
import { QUICK_TASK_EVENT, INBOX_CAPTURE_EVENT } from "@/lib/workspace-events";
import { cn } from "@/lib/utils";

export const UNIFIED_CREATE_EVENT = "ega:open-unified-create";

export type CreateMode = "task" | "backlog";

export type UnifiedCreateSheetProps = {
  projects?: { id: string; name: string }[];
  goals?: { id: string; title: string; project_id: string }[];
  initialMode?: CreateMode;
};

export function UnifiedCreateSheet({
  projects = [],
  goals = [],
  initialMode = "task",
}: UnifiedCreateSheetProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<CreateMode>(initialMode);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftProjectId, setDraftProjectId] = useState(projects[0]?.id ?? "");
  const [taskActiveTab, setTaskActiveTab] = useState<"single" | "multi">("single");
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);

  function closeSheet() {
    setOpen(false);
    setDraftTitle("");
    setTaskActiveTab("single");
  }

  function handleModeChange(newMode: CreateMode) {
    setMode(newMode);
  }

  useEffect(() => {
    const handleQuickTask = () => {
      const activeElement = document.activeElement;
      lastFocusedElementRef.current =
        activeElement instanceof HTMLElement && activeElement !== document.body
          ? activeElement
          : null;
      setMode("task");
      setOpen(true);
    };

    const handleInboxCapture = () => {
      const activeElement = document.activeElement;
      lastFocusedElementRef.current =
        activeElement instanceof HTMLElement && activeElement !== document.body
          ? activeElement
          : null;
      setMode("backlog");
      setOpen(true);
    };

    const handleUnifiedCreate = (event: Event) => {
      const customEvent = event as CustomEvent<{ mode?: CreateMode }>;
      const activeElement = document.activeElement;
      lastFocusedElementRef.current =
        activeElement instanceof HTMLElement && activeElement !== document.body
          ? activeElement
          : null;
      setMode(customEvent.detail?.mode ?? "task");
      setOpen(true);
    };

    window.addEventListener(QUICK_TASK_EVENT, handleQuickTask);
    window.addEventListener(INBOX_CAPTURE_EVENT, handleInboxCapture);
    window.addEventListener(UNIFIED_CREATE_EVENT, handleUnifiedCreate);

    return () => {
      window.removeEventListener(QUICK_TASK_EVENT, handleQuickTask);
      window.removeEventListener(INBOX_CAPTURE_EVENT, handleInboxCapture);
      window.removeEventListener(UNIFIED_CREATE_EVENT, handleUnifiedCreate);
    };
  }, []);

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          closeSheet();
          return;
        }
        setOpen(true);
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-[90] bg-[rgba(17,17,15,0.58)] backdrop-blur-[1px] transition-opacity"
        />
        <DialogPrimitive.Content
          id="unified-create-modal"
          role="dialog"
          aria-labelledby="unified-create-title"
          aria-describedby="unified-create-description"
          onCloseAutoFocus={(event) => {
            const lastFocusedElement = lastFocusedElementRef.current;
            if (lastFocusedElement?.isConnected) {
              event.preventDefault();
              lastFocusedElement.focus();
            }
            lastFocusedElementRef.current = null;
          }}
          className="fixed left-1/2 top-1/2 z-[91] flex max-h-[min(52rem,calc(100dvh-2rem))] w-[calc(100vw-1rem)] max-w-[38rem] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-[var(--ega-border)] bg-[var(--ega-surface)] shadow-[0_28px_80px_rgba(17,17,15,0.3)] outline-none"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[var(--ega-border)] px-5 py-3.5 sm:px-6">
            <div>
              <DialogPrimitive.Title
                id="unified-create-title"
                className="text-[length:var(--text-section)] font-semibold tracking-[var(--tracking-tight)] text-[color:var(--ega-text)]"
              >
                Create
              </DialogPrimitive.Title>
              <DialogPrimitive.Description
                id="unified-create-description"
                className="text-xs text-[color:var(--ega-text-secondary)]"
              >
                Add a task to your plan or capture an idea to your backlog.
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild>
              <Button
                variant="ghost"
                size="sm"
                className="-mr-2 -mt-1 h-9 w-9 shrink-0 rounded-full p-0 text-[color:var(--muted-foreground)] hover:bg-[color:var(--ega-surface-muted)] hover:text-[color:var(--foreground)]"
                aria-label="Close create dialog"
              >
                <X className="h-4 w-4" />
              </Button>
            </DialogPrimitive.Close>
          </div>

          {/* Top-Level Mode Selector */}
          <div className="border-b border-[var(--ega-border)] bg-[var(--ega-surface-subtle)] px-5 py-2 sm:px-6">
            <div
              className="flex rounded-lg bg-[var(--ega-surface-muted)] p-1 text-sm font-medium"
              role="tablist"
              aria-label="Creation type"
            >
              <button
                type="button"
                role="tab"
                id="create-mode-tab-task"
                aria-selected={mode === "task"}
                aria-controls="create-mode-panel-task"
                data-testid="create-tab-task"
                className={cn(
                  "flex-1 rounded-md py-1.5 text-center text-xs font-semibold uppercase tracking-wider transition-all",
                  mode === "task"
                    ? "bg-[var(--ega-surface)] text-[color:var(--ega-text)] shadow-sm"
                    : "text-[color:var(--ega-text-secondary)] hover:text-[color:var(--ega-text)]",
                )}
                onClick={() => handleModeChange("task")}
              >
                Task
              </button>
              <button
                type="button"
                role="tab"
                id="create-mode-tab-backlog"
                aria-selected={mode === "backlog"}
                aria-controls="create-mode-panel-backlog"
                data-testid="create-tab-backlog"
                className={cn(
                  "flex-1 rounded-md py-1.5 text-center text-xs font-semibold uppercase tracking-wider transition-all",
                  mode === "backlog"
                    ? "bg-[var(--ega-surface)] text-[color:var(--ega-text)] shadow-sm"
                    : "text-[color:var(--ega-text-secondary)] hover:text-[color:var(--ega-text)]",
                )}
                onClick={() => handleModeChange("backlog")}
              >
                Backlog
              </button>
            </div>
          </div>

          {/* Form Content */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {mode === "task" ? (
              <div
                id="create-mode-panel-task"
                role="tabpanel"
                aria-labelledby="create-mode-tab-task"
                className="flex min-h-0 flex-1 flex-col overflow-hidden"
              >
                <QuickTaskSheetPanel
                  projects={projects}
                  goals={goals}
                  activeTab={taskActiveTab}
                  onTabChange={setTaskActiveTab}
                  onSuccess={(submittedMode, skippedCount) => {
                    if (submittedMode === "single" || skippedCount === 0) {
                      closeSheet();
                    }
                  }}
                  hideHeader={true}
                  initialCommand={draftTitle}
                  onCommandChange={setDraftTitle}
                  selectedProjectId={draftProjectId}
                  onProjectIdChange={setDraftProjectId}
                />
              </div>
            ) : (
              <div
                id="create-mode-panel-backlog"
                role="tabpanel"
                aria-labelledby="create-mode-tab-backlog"
                className="flex min-h-0 flex-1 flex-col overflow-hidden"
              >
                <InboxCapturePanel
                  projects={projects}
                  title={draftTitle}
                  onTitleChange={setDraftTitle}
                  projectId={draftProjectId}
                  onProjectIdChange={setDraftProjectId}
                  onSuccess={closeSheet}
                  onCancel={closeSheet}
                  hideHeader={true}
                />
              </div>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export const CreateSheet = UnifiedCreateSheet;
