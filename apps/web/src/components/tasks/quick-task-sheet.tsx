"use client";

import { useActionState, useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import {
  createTaskAction,
  type CreateTaskFormState,
} from "@/app/(workspace)/tasks/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  TASK_PRIORITY_VALUES,
  TASK_TITLE_LENGTH_ERROR,
  TASK_TITLE_MAX,
  formatTaskToken,
} from "@/lib/task-domain";

type QuickTaskSheetProject = {
  id: string;
  name: string;
};

type QuickTaskSheetGoal = {
  id: string;
  title: string;
  project_id: string;
};

export type QuickTaskSheetPanelProps = {
  projects: QuickTaskSheetProject[];
  /** Retained for the unified create shell; goals are not required by the lean composer. */
  goals?: QuickTaskSheetGoal[];
  activeTab?: "single" | "multi";
  onTabChange?: (mode: "single" | "multi") => void;
  onSuccess: (mode: "single" | "multi", skippedCount: number) => void;
  hideHeader?: boolean;
  initialCommand?: string;
  onCommandChange?: (command: string) => void;
  selectedProjectId?: string;
  onProjectIdChange?: (projectId: string) => void;
  /** Column the "Add task here" action was opened from, if any. */
  selectedStatus?: string;
};

const DEFAULT_RETURN_TO = "/tasks";

const FIELD_LABEL = "form-label";

/**
 * Primary submit for the lean quick capture.
 *
 * It must use the canonical Button system: the previous legacy variables
 * resolved to the same near-black for both the surface and the label, which
 * rendered the primary action as an unreadable black rectangle.
 */
function QuickTaskSubmitButton({
  label,
  pending,
  disabled = false,
}: {
  label: string;
  pending: boolean;
  disabled?: boolean;
}) {
  return (
    <Button
      type="submit"
      variant="primary"
      disabled={pending || disabled}
      className="h-9 shrink-0 px-4 disabled:bg-[var(--ega-surface-muted)] disabled:text-[color:var(--ega-text-secondary)] disabled:opacity-100"
    >
      {pending ? "Creating\u2026" : label}
    </Button>
  );
}

function initialValues(defaultProjectId: string): CreateTaskFormState["values"] {
  return {
    title: "",
    projectId: defaultProjectId,
    goalId: "",
    description: "",
    blockedReason: "",
    status: "todo",
    priority: "medium",
    dueDate: "",
    estimateMinutes: "",
    recurrenceRule: "",
    recurrenceTimezone: "",
    scheduledStartAt: "",
    scheduledEndAt: "",
    calendarSyncEnabled: "",
    calendarReminderMinutes: "10",
    workedTimeStartedAt: "",
    workedTimeEndedAt: "",
    returnTo: DEFAULT_RETURN_TO,
  };
}

/**
 * One-line task capture with an optional details row.
 *
 * The title is the only required input; project, due date and priority live in
 * a quiet disclosure so the common case stays a single keystroke-and-Enter
 * action. The composer never parses commands or stages multiple drafts; the
 * drawer owns richer editing after creation.
 */
export function QuickTaskSheetPanel({
  projects,
  onSuccess,
  hideHeader = false,
  initialCommand,
  onCommandChange,
  selectedProjectId,
  onProjectIdChange,
}: QuickTaskSheetPanelProps) {
  const defaultProjectId = selectedProjectId || projects[0]?.id || "";
  const [title, setTitle] = useState(initialCommand ?? "");
  const [projectId, setProjectId] = useState(defaultProjectId);
  const [priority, setPriority] = useState("medium");
  const [dueDate, setDueDate] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);

  const initialState: CreateTaskFormState = {
    error: null,
    success: null,
    values: initialValues(defaultProjectId),
  };
  const [state, formAction, pending] = useActionState(
    createTaskAction,
    initialState,
  );

  const titleTooLong = title.length > TASK_TITLE_MAX;

  useEffect(() => {
    const focusId = window.requestAnimationFrame(() => {
      document.getElementById("quick-task-command")?.focus();
    });
    return () => window.cancelAnimationFrame(focusId);
  }, []);

  // The unified shell may load project options after the panel mounts; adopt
  // the first real option so creating a task never fails with an empty project.
  // Render-time adjustment follows the existing QuickTaskSheetPanel pattern.
  const [previousDefaultProjectId, setPreviousDefaultProjectId] =
    useState(defaultProjectId);
  if (defaultProjectId !== previousDefaultProjectId) {
    setPreviousDefaultProjectId(defaultProjectId);
    if (!projectId && defaultProjectId) {
      setProjectId(defaultProjectId);
    }
  }

  useEffect(() => {
    if (state.success) {
      onSuccess("single", 0);
    }
  }, [onSuccess, state.success]);

  // A failed submit restores the server's sanitized values without dropping a
  // detail the user already chose.
  const [previousState, setPreviousState] = useState(state);
  if (state !== previousState) {
    setPreviousState(state);
    setPriority(state.values.priority);
    setDueDate(state.values.dueDate);
    setProjectId(state.values.projectId);
  }

  function handleTitleChange(value: string) {
    setTitle(value);
    onCommandChange?.(value);
  }

  function handleProjectChange(value: string) {
    setProjectId(value);
    onProjectIdChange?.(value);
  }

  return (
    <>
      {!hideHeader ? (
        <div className="border-b border-[var(--ega-border)] px-5 py-4 sm:px-6">
          <DialogPrimitive.Title
            id="quick-task-sheet-title"
            className="text-[length:var(--text-section)] font-semibold tracking-[var(--tracking-tight)] text-[color:var(--ega-text)]"
          >
            New task
          </DialogPrimitive.Title>
          <DialogPrimitive.Description
            id="quick-task-sheet-description"
            className="text-xs text-[color:var(--ega-text-secondary)]"
          >
            Capture the next action. Add details only when they matter.
          </DialogPrimitive.Description>
        </div>
      ) : null}

      <form
        action={formAction}
        className="flex min-h-0 flex-col gap-3 overflow-y-auto px-5 py-4 sm:px-6"
        aria-label="Quick task capture form"
      >
        <input type="hidden" name="returnTo" value={DEFAULT_RETURN_TO} />
        <input type="hidden" name="goalId" value="" />
        <input type="hidden" name="estimateMinutes" value="" />
        <input type="hidden" name="description" value="" />
        <input type="hidden" name="blockedReason" value="" />
        <input type="hidden" name="status" value="todo" />

        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor="quick-task-command" className="sr-only">
              Task title
            </label>
            <Input
              id="quick-task-command"
              name="title"
              value={title}
              onChange={(event) => handleTitleChange(event.target.value)}
              placeholder="Ship the auth fix"
              autoComplete="off"
              required
              aria-describedby="quick-task-title-count quick-task-title-error"
              aria-invalid={titleTooLong}
              className="h-11 w-full text-[length:var(--text-body-lg)]"
            />
            <p
              id="quick-task-title-count"
              className="mt-1 text-[length:var(--text-meta)] tabular-nums text-[color:var(--ega-text-tertiary)]"
              aria-live="polite"
            >
              {title.length}/{TASK_TITLE_MAX}
            </p>
            {titleTooLong ? (
              <p
                id="quick-task-title-error"
                role="alert"
                className="mt-1 text-[length:var(--text-meta)] text-[color:var(--status-overdue)]"
              >
                {TASK_TITLE_LENGTH_ERROR}
              </p>
            ) : null}
          </div>
          <QuickTaskSubmitButton
            label="Create task"
            pending={pending}
            disabled={!title.trim() || titleTooLong}
          />
        </div>

        <details
          className="group rounded-[var(--radius-md)] border border-[var(--ega-border)] bg-[var(--ega-surface-subtle)]"
          open={detailsOpen}
          onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-[length:var(--text-meta-lg)] font-medium text-[color:var(--ega-text-secondary)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--ega-focus-outline)]">
            <span>Details</span>
            <ChevronDown
              className="h-4 w-4 transition-transform group-open:rotate-180 motion-reduce:transition-none"
              aria-hidden="true"
            />
          </summary>
          <div className="grid grid-cols-1 gap-3 border-t border-[var(--ega-divider)] px-3 py-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="quick-task-project" className={FIELD_LABEL}>
                Project
              </label>
              <select
                id="quick-task-project"
                name="projectId"
                value={projectId}
                onChange={(event) => handleProjectChange(event.target.value)}
                className="input-instrument h-9 w-full px-2 text-sm"
                required
              >
                {projects.length === 0 ? <option value="">No project</option> : null}
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="quick-task-priority" className={FIELD_LABEL}>
                Priority
              </label>
              <select
                id="quick-task-priority"
                name="priority"
                value={priority}
                onChange={(event) => setPriority(event.target.value)}
                className="input-instrument h-9 w-full px-2 text-sm"
              >
                {TASK_PRIORITY_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {formatTaskToken(value)}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="quick-task-due-date" className={FIELD_LABEL}>
                Due
              </label>
              <input
                id="quick-task-due-date"
                name="dueDate"
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                className="h-9 w-full rounded-[var(--radius-sm)] border border-[var(--ega-border)] bg-[var(--ega-surface)] px-2 text-sm text-[color:var(--ega-text)]"
              />
            </div>
          </div>
        </details>

        {state.error ? (
          <p role="alert" className="feedback-block feedback-block-error">
            {state.error}
          </p>
        ) : null}

        {projects.length === 0 ? (
          <p role="status" className="feedback-block feedback-block-warn">
            Create a project before adding a task.
          </p>
        ) : null}
      </form>
    </>
  );
}
