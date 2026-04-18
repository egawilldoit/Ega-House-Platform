"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Plus, Trash2, X } from "lucide-react";

import {
  createTaskAction,
  createTasksBulkAction,
  type CreateTaskFormState,
  type CreateTasksBulkFormState,
} from "@/app/tasks/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { workspaceShortcutEvents } from "@/components/layout/workspace-keyboard-shortcuts";
import {
  TASK_PRIORITY_VALUES,
  TASK_STATUS_VALUES,
  formatTaskToken,
  isTaskPriority,
  isTaskStatus,
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

type QuickTaskSheetProps = {
  projects: QuickTaskSheetProject[];
  goals: QuickTaskSheetGoal[];
  initialMode?: "single" | "multi";
};

type QuickTaskSheetPanelProps = {
  projects: QuickTaskSheetProject[];
  goals: QuickTaskSheetGoal[];
  activeTab: "single" | "multi";
  onTabChange: (mode: "single" | "multi") => void;
  onClose: () => void;
  onSuccess: (mode: "single" | "multi", skippedCount: number) => void;
};

const DEFAULT_RETURN_TO = "/tasks";

type MultiTaskDraft = {
  id: string;
  title: string;
  projectId: string;
  goalId: string;
  status: string;
  priority: string;
  dueDate: string;
  estimateMinutes: string;
  description: string;
};

function getGoalsForProject(goals: QuickTaskSheetGoal[], projectId: string) {
  return goals.filter((goal) => goal.project_id === projectId);
}

function createDraftId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createEmptyDraft(defaultProjectId: string): MultiTaskDraft {
  return {
    id: createDraftId(),
    title: "",
    projectId: defaultProjectId,
    goalId: "",
    status: "todo",
    priority: "medium",
    dueDate: "",
    estimateMinutes: "",
    description: "",
  };
}

function getDraftErrors(draft: MultiTaskDraft, goals: QuickTaskSheetGoal[]) {
  const errors: string[] = [];

  if (!draft.title.trim()) {
    errors.push("Task title is required.");
  }

  if (!draft.projectId) {
    errors.push("Project is required.");
  }

  if (!isTaskStatus(draft.status)) {
    errors.push(`Status "${draft.status}" is invalid.`);
  }

  if (!isTaskPriority(draft.priority)) {
    errors.push(`Priority "${draft.priority}" is invalid.`);
  }

  if (draft.estimateMinutes.trim() && !/^\d+$/.test(draft.estimateMinutes.trim())) {
    errors.push("Estimate must be a whole number of minutes.");
  }

  if (
    draft.goalId &&
    !goals.some((goal) => goal.id === draft.goalId && goal.project_id === draft.projectId)
  ) {
    errors.push("Selected goal does not belong to the chosen project.");
  }

  return errors;
}

function QuickTaskSheetPanel({
  projects,
  goals,
  activeTab,
  onTabChange,
  onClose,
  onSuccess,
}: QuickTaskSheetPanelProps) {
  const defaultProjectId = projects[0]?.id ?? "";
  const [singleProjectId, setSingleProjectId] = useState(defaultProjectId);
  const [singleGoalId, setSingleGoalId] = useState("");
  const [drafts, setDrafts] = useState<MultiTaskDraft[]>([
    createEmptyDraft(defaultProjectId),
  ]);

  const initialSingleState: CreateTaskFormState = {
    error: null,
    success: null,
    values: {
      title: "",
      projectId: defaultProjectId,
      goalId: "",
      description: "",
      status: "todo",
      priority: "medium",
      dueDate: "",
      estimateMinutes: "",
      returnTo: DEFAULT_RETURN_TO,
    },
  };
  const initialBulkState: CreateTasksBulkFormState = {
    error: null,
    success: null,
    createdCount: 0,
    skippedLines: [],
    values: {
      titles: "",
      projectId: defaultProjectId,
      goalId: "",
      description: "",
      status: "todo",
      priority: "medium",
      dueDate: "",
      estimateMinutes: "",
      returnTo: DEFAULT_RETURN_TO,
    },
  };

  const [singleState, singleAction, isSinglePending] = useActionState(
    createTaskAction,
    initialSingleState,
  );
  const [bulkState, bulkAction, isBulkPending] = useActionState(
    createTasksBulkAction,
    initialBulkState,
  );

  const singleGoals = getGoalsForProject(goals, singleProjectId);
  const draftValidation = drafts.map((draft) => ({
    id: draft.id,
    errors: getDraftErrors(draft, goals),
  }));
  const readyDraftCount = draftValidation.filter((draft) => draft.errors.length === 0).length;
  const invalidDraftCount = draftValidation.length - readyDraftCount;

  useEffect(() => {
    if (singleState.success) {
      onSuccess("single", 0);
    }
  }, [onSuccess, singleState.success]);

  useEffect(() => {
    if (bulkState.success) {
      onSuccess("multi", bulkState.skippedLines.length);
    }
  }, [bulkState.skippedLines.length, bulkState.success, onSuccess]);

  useEffect(() => {
    const focusId = window.requestAnimationFrame(() => {
      document.getElementById("quick-task-title")?.focus();
    });

    return () => window.cancelAnimationFrame(focusId);
  }, []);

  function updateDraft(
    draftId: string,
    updater: (draft: MultiTaskDraft) => MultiTaskDraft,
  ) {
    setDrafts((currentDrafts) =>
      currentDrafts.map((draft) => (draft.id === draftId ? updater(draft) : draft)),
    );
  }

  function addDraft(count = 1) {
    setDrafts((currentDrafts) => [
      ...currentDrafts,
      ...Array.from({ length: count }, () => createEmptyDraft(defaultProjectId)),
    ]);
  }

  function duplicateDraft(draftId: string) {
    setDrafts((currentDrafts) => {
      const nextDrafts: MultiTaskDraft[] = [];

      for (const draft of currentDrafts) {
        nextDrafts.push(draft);

        if (draft.id === draftId) {
          nextDrafts.push({
            ...draft,
            id: createDraftId(),
          });
        }
      }

      return nextDrafts;
    });
  }

  function removeDraft(draftId: string) {
    setDrafts((currentDrafts) => {
      const nextDrafts = currentDrafts.filter((draft) => draft.id !== draftId);

      if (nextDrafts.length > 0) {
        return nextDrafts;
      }

      return [createEmptyDraft(defaultProjectId)];
    });
  }

  function clearAllDrafts() {
    setDrafts([createEmptyDraft(defaultProjectId)]);
  }

  function updateDraftField<K extends keyof MultiTaskDraft>(
    draftId: string,
    key: K,
    value: MultiTaskDraft[K],
  ) {
    updateDraft(draftId, (draft) => {
      const nextDraft = { ...draft, [key]: value };

      if (key === "projectId") {
        nextDraft.goalId = goals.some(
          (goal) => goal.id === nextDraft.goalId && goal.project_id === String(value),
        )
          ? nextDraft.goalId
          : "";
      }

      return nextDraft;
    });
  }

  const serializedBulkRows = JSON.stringify(
    drafts.map((draft, index) => ({
      lineNumber: index + 1,
      title: draft.title.trim(),
      projectId: draft.projectId,
      goalId: draft.goalId,
      description: draft.description,
      status: draft.status,
      priority: draft.priority,
      dueDate: draft.dueDate,
      estimateMinutes: draft.estimateMinutes,
    })),
  );

  return (
    <>
      <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 pb-4 pt-5 sm:px-6">
        <SheetHeader className="min-w-0">
          <p className="glass-label text-signal-live">Execution Capture</p>
          <SheetTitle>Quick task</SheetTitle>
          <SheetDescription>
            Create one task fast or stage multiple tasks in a single pass. Ownership stays
            server-side under the current RLS model.
          </SheetDescription>
        </SheetHeader>

        <Button
          variant="ghost"
          size="sm"
          className="mt-1 h-9 w-9 shrink-0 rounded-full p-0"
          aria-label="Close quick task panel"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6">
        {projects.length === 0 ? (
          <div className="rounded-[1.15rem] border border-[var(--border)] bg-[color:var(--instrument)] p-5">
            <p className="glass-label text-etch">Project required</p>
            <p className="mt-2 text-sm leading-6 text-[color:var(--muted-foreground)]">
              Create a project first. Tasks stay scoped to visible projects, so quick capture
              remains unavailable until a project exists.
            </p>
          </div>
        ) : (
          <Tabs value={activeTab} onValueChange={(value) => onTabChange(value as "single" | "multi")} className="space-y-4">
            <TabsList>
              <TabsTrigger value="single">Single</TabsTrigger>
              <TabsTrigger value="multi">Multi</TabsTrigger>
            </TabsList>

            <TabsContent value="single" className="space-y-4">
              <form action={singleAction} className="space-y-4">
                <input type="hidden" name="returnTo" value={DEFAULT_RETURN_TO} />

                <div className="rounded-[1.1rem] border border-[var(--border)] bg-[color:var(--instrument)] p-4">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                      <p className="glass-label text-etch">Single task</p>
                      <p className="mt-1 text-xs leading-5 text-[color:var(--muted-foreground)]">
                        Fast capture for one task with the same server validation as the full task
                        page.
                      </p>
                    </div>
                    <span className="rounded-full border border-[var(--border)] bg-white/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
                      Compact
                    </span>
                  </div>

                  <div className="space-y-3.5">
                    <div className="space-y-2">
                      <label htmlFor="quick-task-title" className="glass-label text-etch">
                        Title
                      </label>
                      <Input
                        id="quick-task-title"
                        name="title"
                        required
                        placeholder="Ship sidebar quick capture"
                        defaultValue={singleState.values.title}
                        className="h-10"
                      />
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <label htmlFor="quick-task-project" className="glass-label text-etch">
                          Project
                        </label>
                        <select
                          id="quick-task-project"
                          name="projectId"
                          value={singleProjectId}
                          onChange={(event) => {
                            setSingleProjectId(event.target.value);
                            setSingleGoalId("");
                          }}
                          className="input-instrument h-10 text-sm"
                        >
                          {projects.map((project) => (
                            <option key={project.id} value={project.id}>
                              {project.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-2">
                        <label htmlFor="quick-task-goal" className="glass-label text-etch">
                          Goal
                        </label>
                        <select
                          id="quick-task-goal"
                          name="goalId"
                          value={singleGoalId}
                          onChange={(event) => setSingleGoalId(event.target.value)}
                          className="input-instrument h-10 text-sm"
                        >
                          <option value="">No goal</option>
                          {singleGoals.map((goal) => (
                            <option key={goal.id} value={goal.id}>
                              {goal.title}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <label htmlFor="quick-task-status" className="glass-label text-etch">
                          Status
                        </label>
                        <select
                          id="quick-task-status"
                          name="status"
                          defaultValue={singleState.values.status}
                          className="input-instrument h-10 text-sm"
                        >
                          {TASK_STATUS_VALUES.map((status) => (
                            <option key={status} value={status}>
                              {formatTaskToken(status)}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-2">
                        <label htmlFor="quick-task-due-date" className="glass-label text-etch">
                          Due date
                        </label>
                        <Input
                          id="quick-task-due-date"
                          name="dueDate"
                          type="date"
                          defaultValue={singleState.values.dueDate}
                          className="h-10"
                        />
                      </div>

                      <div className="space-y-2">
                        <label htmlFor="quick-task-priority" className="glass-label text-etch">
                          Priority
                        </label>
                        <select
                          id="quick-task-priority"
                          name="priority"
                          defaultValue={singleState.values.priority}
                          className="input-instrument h-10 text-sm"
                        >
                          {TASK_PRIORITY_VALUES.map((priority) => (
                            <option key={priority} value={priority}>
                              {formatTaskToken(priority)}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-2">
                        <label htmlFor="quick-task-estimate" className="glass-label text-etch">
                          Estimate (minutes)
                        </label>
                        <Input
                          id="quick-task-estimate"
                          name="estimateMinutes"
                          type="number"
                          min="0"
                          step="15"
                          inputMode="numeric"
                          defaultValue={singleState.values.estimateMinutes}
                          className="h-10"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label htmlFor="quick-task-description" className="glass-label text-etch">
                        Description
                      </label>
                      <Textarea
                        id="quick-task-description"
                        name="description"
                        placeholder="Capture scope, constraint, or delivery note."
                        defaultValue={singleState.values.description}
                        className="min-h-24 resize-none"
                      />
                    </div>
                  </div>
                </div>

                {singleState.error ? (
                  <div role="alert" className="feedback-block feedback-block-error">
                    {singleState.error}
                  </div>
                ) : null}

                <div className="flex items-center justify-end border-t border-[var(--border)] pt-4">
                  <Button type="submit" disabled={isSinglePending}>
                    {isSinglePending ? "Creating..." : "Create task"}
                  </Button>
                </div>
              </form>
            </TabsContent>

            <TabsContent value="multi" className="space-y-4">
              <form action={bulkAction} className="space-y-4">
                <input type="hidden" name="returnTo" value={DEFAULT_RETURN_TO} />
                <input type="hidden" name="rows" value={serializedBulkRows} />
                <div className="rounded-[1.1rem] border border-[var(--border)] bg-[color:var(--instrument)] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="glass-label text-signal-live">Batch builder</p>
                      <h3 className="mt-1 text-base font-semibold text-[color:var(--foreground)]">
                        Add multiple tasks visually
                      </h3>
                      <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">
                        Each card is one task with its own project, goal, priority, status, and
                        notes.
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button type="button" variant="muted" size="sm" onClick={() => addDraft(5)}>
                        Add 5 tasks
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={clearAllDrafts}>
                        Clear all
                      </Button>
                      <Button type="button" onClick={() => addDraft()}>
                        Add task
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  {drafts.map((draft, index) => {
                    const draftGoals = getGoalsForProject(goals, draft.projectId);
                    const draftErrors =
                      draftValidation.find((entry) => entry.id === draft.id)?.errors ?? [];

                    return (
                      <div
                        key={draft.id}
                        className={`rounded-[1rem] border px-4 py-4 shadow-sm ${
                          draftErrors.length > 0
                            ? "border-[rgba(198,40,40,0.18)] bg-[rgba(198,40,40,0.04)]"
                            : "border-[var(--border)] bg-white"
                        }`}
                      >
                        <div className="mb-4 flex items-center justify-between gap-3">
                          <div>
                            <p className="glass-label text-etch">Task {index + 1}</p>
                            <p className="text-sm text-[color:var(--muted-foreground)]">
                              Configure this task independently before batch create.
                            </p>
                          </div>

                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="gap-2"
                              onClick={() => duplicateDraft(draft.id)}
                            >
                              <Copy className="h-3.5 w-3.5" />
                              Duplicate
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="gap-2 text-signal-error hover:text-signal-error"
                              onClick={() => removeDraft(draft.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Remove
                            </Button>
                          </div>
                        </div>

                        <div className="space-y-4">
                          <div className="space-y-2">
                            <label className="glass-label text-etch">Title</label>
                            <Input
                              value={draft.title}
                              onChange={(event) =>
                                updateDraftField(draft.id, "title", event.target.value)
                              }
                              placeholder="What needs to be done?"
                              className="h-10"
                            />
                          </div>

                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-2">
                              <label className="glass-label text-etch">Project</label>
                              <select
                                value={draft.projectId}
                                onChange={(event) =>
                                  updateDraftField(draft.id, "projectId", event.target.value)
                                }
                                className="input-instrument h-10 text-sm"
                              >
                                {projects.map((project) => (
                                  <option key={project.id} value={project.id}>
                                    {project.name}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div className="space-y-2">
                              <label className="glass-label text-etch">Goal</label>
                              <select
                                value={draft.goalId}
                                onChange={(event) =>
                                  updateDraftField(draft.id, "goalId", event.target.value)
                                }
                                className="input-instrument h-10 text-sm"
                              >
                                <option value="">No goal</option>
                                {draftGoals.map((goal) => (
                                  <option key={goal.id} value={goal.id}>
                                    {goal.title}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div className="space-y-2">
                              <label className="glass-label text-etch">Status</label>
                              <select
                                value={draft.status}
                                onChange={(event) =>
                                  updateDraftField(draft.id, "status", event.target.value)
                                }
                                className="input-instrument h-10 text-sm"
                              >
                                {TASK_STATUS_VALUES.map((status) => (
                                  <option key={status} value={status}>
                                    {formatTaskToken(status)}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div className="space-y-2">
                              <label className="glass-label text-etch">Priority</label>
                              <select
                                value={draft.priority}
                                onChange={(event) =>
                                  updateDraftField(draft.id, "priority", event.target.value)
                                }
                                className="input-instrument h-10 text-sm"
                              >
                                {TASK_PRIORITY_VALUES.map((priority) => (
                                  <option key={priority} value={priority}>
                                    {formatTaskToken(priority)}
                                  </option>
                                  ))}
                              </select>
                            </div>

                            <div className="space-y-2">
                              <label className="glass-label text-etch">Due date</label>
                              <Input
                                type="date"
                                value={draft.dueDate}
                                onChange={(event) =>
                                  updateDraftField(draft.id, "dueDate", event.target.value)
                                }
                                className="h-10"
                              />
                            </div>

                            <div className="space-y-2">
                              <label className="glass-label text-etch">Estimate (minutes)</label>
                              <Input
                                type="number"
                                min="0"
                                step="15"
                                inputMode="numeric"
                                value={draft.estimateMinutes}
                                onChange={(event) =>
                                  updateDraftField(draft.id, "estimateMinutes", event.target.value)
                                }
                                className="h-10"
                              />
                            </div>
                          </div>

                          <div className="space-y-2">
                            <label className="glass-label text-etch">Description</label>
                            <Textarea
                              value={draft.description}
                              onChange={(event) =>
                                updateDraftField(draft.id, "description", event.target.value)
                              }
                              placeholder="Optional note for this task."
                              className="min-h-24 resize-none"
                            />
                          </div>
                        </div>

                        {draftErrors.length > 0 ? (
                          <div className="mt-3 space-y-1.5 rounded-[0.9rem] border border-[rgba(198,40,40,0.14)] bg-[rgba(198,40,40,0.04)] px-3 py-3 text-xs leading-5 text-signal-error">
                            {draftErrors.map((error) => (
                              <p key={`${draft.id}-${error}`}>{error}</p>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                {bulkState.error ? (
                  <div role="alert" className="feedback-block feedback-block-error">
                    {bulkState.error}
                  </div>
                ) : null}

                {bulkState.success && bulkState.skippedLines.length > 0 ? (
                  <div className="feedback-block feedback-block-warn">
                    {bulkState.success} Some tasks were skipped by the server and remain listed
                    below.
                  </div>
                ) : null}

                {bulkState.skippedLines.length > 0 ? (
                  <div className="rounded-[1rem] border border-[var(--border)] bg-white/80 p-3">
                    <p className="glass-label text-etch">Skipped tasks</p>
                    <div className="mt-2 space-y-1.5 text-xs leading-5 text-[color:var(--muted-foreground)]">
                      {bulkState.skippedLines.map((entry, index) => (
                        <p key={`${entry.value}-${index}`}>
                          <span className="font-medium text-[color:var(--foreground)]">
                            {entry.value}
                          </span>{" "}
                          <span>{entry.reason}</span>
                        </p>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="flex items-center justify-end border-t border-[var(--border)] pt-4">
                  <div className="flex w-full flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-[color:var(--muted-foreground)]">
                      {invalidDraftCount > 0
                        ? `${invalidDraftCount} of ${drafts.length} task${drafts.length === 1 ? "" : "s"} need attention`
                        : `${readyDraftCount} task${readyDraftCount === 1 ? "" : "s"} ready`}
                    </p>

                    <Button
                      type="submit"
                      disabled={isBulkPending || readyDraftCount === 0 || invalidDraftCount > 0}
                    >
                      {isBulkPending ? "Creating..." : "Create tasks"}
                    </Button>
                  </div>
                </div>
              </form>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </>
  );
}

export function QuickTaskSheet({
  projects,
  goals,
  initialMode = "single",
}: QuickTaskSheetProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sessionKey, setSessionKey] = useState(0);
  const [activeTab, setActiveTab] = useState<"single" | "multi">(initialMode);

  function closeSheet() {
    setOpen(false);
    setActiveTab("single");
    setSessionKey((value) => value + 1);
  }

  function handleSuccess(mode: "single" | "multi", skippedCount: number) {
    if (mode === "single" || skippedCount === 0) {
      closeSheet();
    }

    router.refresh();
  }

  useEffect(() => {
    const openFromShortcut = () => {
      setActiveTab("single");
      setOpen(true);
    };

    window.addEventListener(workspaceShortcutEvents.openQuickTask, openFromShortcut);
    return () => {
      window.removeEventListener(workspaceShortcutEvents.openQuickTask, openFromShortcut);
    };
  }, []);

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          closeSheet();
          return;
        }

        setOpen(true);
      }}
    >
      <SheetTrigger asChild>
        <Button className="mx-4 mt-4 h-auto justify-start gap-3 rounded-[0.9rem] border border-[rgba(23,123,82,0.14)] bg-[rgba(23,123,82,0.08)] px-4 py-3 text-left text-[color:var(--accent)] shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] hover:bg-[rgba(23,123,82,0.12)]">
          <span className="flex h-9 w-9 items-center justify-center rounded-[0.8rem] bg-white/80 text-[color:var(--accent)] shadow-[0_10px_24px_rgba(23,123,82,0.14)]">
            <Plus className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold tracking-[-0.02em]">Quick task</span>
            <span className="mt-0.5 block text-xs text-[color:var(--muted-foreground)]">
              Capture one task or stage a batch without leaving the workspace.
            </span>
          </span>
        </Button>
      </SheetTrigger>

      <SheetContent className="flex flex-col">
        {open ? (
          <QuickTaskSheetPanel
            key={sessionKey}
            projects={projects}
            goals={goals}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            onClose={closeSheet}
            onSuccess={handleSuccess}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
