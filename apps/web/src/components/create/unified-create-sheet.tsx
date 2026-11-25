"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { loadCreateOptionsAction } from "@/app/(workspace)/create-options-actions";
import type { CreateCalendarDefaults } from "@/lib/services/create-options-service";
import { Button } from "@/components/ui/button";
import { QuickTaskSheetPanel } from "@/components/tasks/quick-task-sheet";
import { InboxCapturePanel } from "@/components/inbox/inbox-capture-sheet";
import { QUICK_TASK_EVENT, INBOX_CAPTURE_EVENT } from "@/lib/workspace-events";
import { isTaskStatus } from "@/lib/task-domain";
import { cn } from "@/lib/utils";

export const UNIFIED_CREATE_EVENT = "ega:open-unified-create";

export type CreateMode = "task" | "backlog";

export type UnifiedCreateSheetProps = {
  projects?: { id: string; name: string }[];
  goals?: { id: string; title: string; project_id: string }[];
  ownerId?: string | null;
  initialMode?: CreateMode;
};

export function UnifiedCreateSheet({
  projects = [],
  goals = [],
  ownerId = null,
  initialMode = "task",
}: UnifiedCreateSheetProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<CreateMode>(initialMode);
  const [draftTitle, setDraftTitle] = useState("");
  const [taskProjectId, setTaskProjectId] = useState(projects[0]?.id ?? "");
  const [taskStatus, setTaskStatus] = useState("todo");
  const [backlogProjectId, setBacklogProjectId] = useState(projects[0]?.id ?? "");
  const [taskActiveTab, setTaskActiveTab] = useState<"single" | "multi">("single");
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);
  const [loadedOptions, setLoadedOptions] = useState<{
    projects: { id: string; name: string }[];
    goals: { id: string; title: string; project_id: string }[];
    calendarDefaults?: CreateCalendarDefaults;
  } | null>(null);
  const optionsRequestRef = useRef<Promise<void> | null>(null);

  const resolvedProjects = projects.length > 0 ? projects : (loadedOptions?.projects ?? []);
  const resolvedGoals = goals.length > 0 ? goals : (loadedOptions?.goals ?? []);
  const resolvedCalendarDefaults = loadedOptions?.calendarDefaults;
  const effectiveTaskProjectId = taskProjectId || resolvedProjects[0]?.id || "";
  const effectiveBacklogProjectId = backlogProjectId || resolvedProjects[0]?.id || "";

  // The shell passes no eager options; fetch them the first time a create
  // surface is requested so task creation works without charging every route.
  const ensureOptions = useCallback((): Promise<void> => {
    if ((projects.length > 0 && loadedOptions) || optionsRequestRef.current) {
      return optionsRequestRef.current ?? Promise.resolve();
    }
    const request = loadCreateOptionsAction()
      .then((result) => {
        setLoadedOptions({
          projects: result.projects ?? [],
          goals: result.goals ?? [],
          calendarDefaults: result.calendarDefaults,
        });
      })
      .catch(() => {
        setLoadedOptions({ projects: [], goals: [] });
      })
      .finally(() => {
        optionsRequestRef.current = null;
      });
    optionsRequestRef.current = request;
    return request;
  }, [projects, loadedOptions]);

  function closeSheet() {
    setOpen(false);
    setDraftTitle("");
    setTaskActiveTab("single");
  }

  function handleModeChange(newMode: CreateMode) {
    setMode(newMode);
  }

  useEffect(() => {
    const handleQuickTask = async (event: Event) => {
      const activeElement = document.activeElement;
      lastFocusedElementRef.current =
        activeElement instanceof HTMLElement && activeElement !== document.body
          ? activeElement
          : null;
      const detail = (event as CustomEvent<{ status?: string }>).detail;
      await ensureOptions();
      setTaskStatus(
        detail?.status && isTaskStatus(detail.status) ? detail.status : "todo",
      );
      setMode("task");
      setOpen(true);
    };

    const handleInboxCapture = async () => {
      const activeElement = document.activeElement;
      lastFocusedElementRef.current =
        activeElement instanceof HTMLElement && activeElement !== document.body
          ? activeElement
          : null;
      await ensureOptions();
      setMode("backlog");
      setOpen(true);
    };

    const handleUnifiedCreate = async (event: Event) => {
      const customEvent = event as CustomEvent<{ mode?: CreateMode }>;
      const activeElement = document.activeElement;
      lastFocusedElementRef.current =
        activeElement instanceof HTMLElement && activeElement !== document.body
          ? activeElement
          : null;
      await ensureOptions();
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
  }, [ensureOptions]);

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
          className="fixed inset-0 z-[90] bg-[var(--ega-overlay)] backdrop-blur-[1px] transition-opacity"
        />
        <DialogPrimitive.Content
          id="unified-create-modal"
          role="dialog"
          aria-labelledby="unified-create-title"
          aria-describedby="unified-create-description"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            const targetId = mode === "task" ? "quick-task-command" : "inbox-capture-title";
            const target = document.getElementById(targetId);
            if (target instanceof HTMLElement) {
              target.focus();
            }
          }}
          onCloseAutoFocus={(event) => {
            const lastFocusedElement = lastFocusedElementRef.current;
            if (lastFocusedElement?.isConnected) {
              event.preventDefault();
              lastFocusedElement.focus();
            }
            lastFocusedElementRef.current = null;
          }}
          className="fixed left-1/2 top-1/2 z-[91] flex max-h-[min(52rem,calc(100dvh-2rem))] w-[calc(100vw-1rem)] max-w-[38rem] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-[var(--ega-border)] bg-[var(--ega-surface)] shadow-[var(--ega-shadow-lg)] outline-none"
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
                  key={`task-${taskStatus}`}
                  projects={resolvedProjects}
                  goals={resolvedGoals}
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
                  selectedProjectId={effectiveTaskProjectId}
                  onProjectIdChange={setTaskProjectId}
                  selectedStatus={taskStatus}
                  calendarDefaults={resolvedCalendarDefaults}
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
                  projects={resolvedProjects}
                  ownerId={ownerId}
                  title={draftTitle}
                  onTitleChange={setDraftTitle}
                  projectId={effectiveBacklogProjectId}
                  onProjectIdChange={setBacklogProjectId}
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
