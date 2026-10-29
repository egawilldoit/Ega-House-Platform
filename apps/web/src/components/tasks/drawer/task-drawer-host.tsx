"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { formatTaskToken } from "@/lib/task-domain";
import type { TaskDrawerDetail } from "@/lib/services/task-service";

import { PendingSubmitButton } from "@/components/ui/pending-submit-button";

import { StatusIcon, type TaskStatusIconName } from "@/components/ui/status-icon";
import { PriorityIcon, type TaskPriorityIconName } from "@/components/ui/priority-icon";
import { TaskDrawer } from "./task-drawer";
import { TaskDrawerDetailForm } from "./task-drawer-detail-form";
import { TaskDrawerShortcuts } from "./task-drawer-shortcuts";
import { TaskSubtasks } from "./task-subtasks";
import { TaskActivityList } from "./task-activity-list";
import { TaskCommentsTab, type TaskCommentActionSet } from "./task-comments-tab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Star } from "lucide-react";
import type { TaskActivityItem } from "@/lib/task-activity";
import type {
  TaskAttachmentDto,
  TaskCommentDto,
  TaskCommentMentionCandidateDto,
  SubtaskDto,
} from "@ega/contracts";
import { TaskAttachmentsSection } from "./task-attachments-section";
import { useTaskDrawerParam } from "./use-task-drawer-param";
import { useWorkspacePreferences } from "@/components/layout/workspace-preferences-provider";

const KNOWN_STATUSES: TaskStatusIconName[] = ["todo", "in_progress", "done", "blocked"];
const KNOWN_PRIORITIES: TaskPriorityIconName[] = ["low", "medium", "high", "urgent"];

function isStatus(value: string): value is TaskStatusIconName {
  return (KNOWN_STATUSES as string[]).includes(value);
}

function isPriority(value: string): value is TaskPriorityIconName {
  return (KNOWN_PRIORITIES as string[]).includes(value);
}

function statusLabel(status: TaskStatusIconName) {
  return status.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

type PropertyFieldProps = {
  action: TaskFieldAction;
  taskId: string;
  returnTo: string;
  field: "status" | "priority" | "startDate" | "dueDate" | "estimateMinutes" | "blockedReason" | "title";
  label: string;
  value: string;
  type?: "date" | "number";
  options?: Array<{ value: string; label: string }>;
};

/**
 * One-field inline editor.
 *
 * A native control posts to `updateTaskFieldAction`, which merges the single
 * changed field into the server-side row. `onChange` submits so a picker closes
 * in one action; the submit button keeps it usable with keyboard only and
 * without JavaScript.
 */
function PropertyField({
  action,
  taskId,
  returnTo,
  field,
  label,
  value,
  type,
  options,
}: PropertyFieldProps) {
  return (
    <form action={action} className="flex items-center gap-1">
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <input type="hidden" name="field" value={field} />
      {options ? (
        <select
          name="value"
          aria-label={label}
          defaultValue={value}
          className="h-7 rounded-[var(--radius-sm)] border border-[var(--ega-border)] bg-[var(--ega-surface)] px-1.5 text-xs text-[color:var(--ega-text)]"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          name="value"
          aria-label={label}
          type={type ?? "text"}
          defaultValue={value}
          className="h-7 rounded-[var(--radius-sm)] border border-[var(--ega-border)] bg-[var(--ega-surface)] px-1.5 text-xs text-[color:var(--ega-text)]"
        />
      )}
      <PendingSubmitButton
        type="submit"
        variant="secondary"
        size="sm"
        aria-label={`Save ${label}`}
        className="h-7 px-1.5 text-xs"
        pendingLabel="Saving…"
      >
        Save
      </PendingSubmitButton>
    </form>
  );
}

/** Server action passed from the page so the client bundle stays server-free. */
export type TaskFieldAction = (formData: FormData) => void | Promise<void>;

/** `useActionState` action that returns state instead of redirecting. */
export type TaskFieldDraftAction = (
  state: import("@/lib/task-field-draft").TaskFieldDraftState,
  formData: FormData,
) => Promise<import("@/lib/task-field-draft").TaskFieldDraftState>;

type TaskDrawerHostProps = {
  /** Owner-scoped detail loaded by the page model, or null. */
  task: TaskDrawerDetail | null;
  /** The lookup failed operationally — distinct from "no such task". */
  loadFailed?: boolean;
  /** One-field patch action for the inline property editors. */
  updateFieldAction: TaskFieldAction;
  /** Draft-preserving action used by the title and description editors. */
  updateDraftAction: TaskFieldDraftAction;
  /** Owner for the character-shortcut preference; null when unauthenticated. */
  ownerId?: string | null;
  /** Ordered checklist items for the selected task. */
  subtasks?: SubtaskDto[];
  /** Owner-scoped attachments for the selected task. */
  attachments?: TaskAttachmentDto[];
  /** Attachment lookup failure, distinct from an empty list. */
  attachmentsError?: string | null;
  /** Durable activity rows for the selected task. */
  activity?: TaskActivityItem[];
  /** Owner-scoped comment thread and composer. */
  comments?: TaskCommentDto[];
  commentMentions?: TaskCommentMentionCandidateDto[];
  commentsError?: string | null;
  commentActions?: TaskCommentActionSet;
  /** Whether older activity exists beyond the rows shown. */
  activityHasMore?: boolean;
  /** Whether the selected task is a navigation favourite. */
  isFavourite?: boolean;
  /** Server action that toggles the task favourite. */
  favouriteAction?: (formData: FormData) => void | Promise<void>;
  /** Server actions for the checklist, passed from the page. */
  subtaskActions?: {
    addAction: (formData: FormData) => void | Promise<void>;
    toggleAction: (formData: FormData) => void | Promise<void>;
    renameAction: (formData: FormData) => void | Promise<void>;
    deleteAction: (formData: FormData) => void | Promise<void>;
    moveAction: (formData: FormData) => void | Promise<void>;
    promoteAction: (formData: FormData) => void | Promise<void>;
  };
  /** Field-patch failure surfaced by the action's redirect. */
  updateError?: string | null;
  /** Field-patch success surfaced by the action's redirect. */
  updateSuccess?: string | null;
  /** Add/remove "blocked by" edges for the selected task. */
  addDependencyAction: TaskFieldAction;
  removeDependencyAction: TaskFieldAction;
};

/**
 * Mount point for the selected-task drawer.
 *
 * The URL is the authority: the drawer opens iff `?task=` is present, so direct
 * links and Back/Forward work without extra state. When the id resolves to
 * nothing the drawer still opens but shows an unavailable state that is
 * identical for a missing task and for another owner's task.
 */
export function TaskDrawerHost({
  task,
  loadFailed = false,
  updateFieldAction,
  updateDraftAction,
  ownerId = null,
  subtasks = [],
  attachments = [],
  attachmentsError = null,
  activity = [],
  comments = [],
  commentMentions = [],
  commentsError = null,
  commentActions,
  activityHasMore = false,
  isFavourite = false,
  favouriteAction,
  subtaskActions,
  updateError = null,
  updateSuccess = null,
  addDependencyAction,
  removeDependencyAction,
}: TaskDrawerHostProps) {
  const { taskOpenMode } = useWorkspacePreferences();
  const { taskId, mode, close, setMode } = useTaskDrawerParam(taskOpenMode);
  // Scoped to the task it belongs to: a stale flag must never make a later,
  // unrelated task ask to discard nothing.
  const [dirtyTaskId, setDirtyTaskId] = useState<string | null>(null);
  const [shortcutMessage, setShortcutMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"comments" | "activity">("comments");
  const dirty = Boolean(taskId) && dirtyTaskId === taskId;
  const handleDirtyChange = useCallback(
    (next: boolean) => setDirtyTaskId(next ? taskId : null),
    [taskId],
  );
  const requestClose = useCallback(() => {
    // Dirty drafts are the user's work: never discard them silently. A plain
    // confirm keeps the check available without adding a second modal system.
    if (dirty && !window.confirm("Discard unsaved changes to this task?")) return;
    setDirtyTaskId(null);
    close();
  }, [close, dirty]);

  // Switching to another task is the same discard decision as closing, and the
  // entry points are links. While a draft is dirty, intercept those links (and
  // leave the browser to its native unload prompt for Back/refresh).
  useEffect(() => {
    if (!dirty) return;
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const url = new URL(anchor.href, window.location.origin);
      if (url.origin !== window.location.origin) return;
      const nextTask = url.searchParams.get("task");
      if (!nextTask || nextTask === taskId) return;
      if (!window.confirm("Discard unsaved changes to this task?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [dirty, taskId]);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Strip workspace feedback flash params: they belong to the previous action and
  // would otherwise be replayed into this form's redirect, keeping a stale error
  // visible after a successful save.
  const returnTo = (() => {
    const params = new URLSearchParams(searchParams.toString());
    for (const key of [
      "taskUpdateError",
      "taskUpdateSuccess",
      "taskUpdateTaskId",
      "statusUpdateError",
      "viewError",
      "viewSuccess",
    ]) {
      params.delete(key);
    }
    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
  })();

  if (!taskId) {
    return (
      <TaskDrawer
        task={null}
        mode={mode}
        onClose={close}
        onRequestClose={requestClose}
        onModeChange={setMode}
      />
    );
  }

  if (loadFailed) {
    return (
      <TaskDrawer
        task={{ id: taskId, title: "Task details unavailable", status: "unknown" }}
        mode={mode}
        onClose={close}
        onRequestClose={requestClose}
        onModeChange={setMode}
      >
        <p className="text-sm text-[color:var(--ega-text-secondary)]">
          Unable to load this task right now.
        </p>
        <button
          type="button"
          onClick={() => router.refresh()}
          className="mt-3 inline-flex h-8 items-center rounded-[var(--radius-sm)] border border-[var(--ega-border)] px-3 text-xs text-[color:var(--ega-text)] hover:bg-[var(--ega-surface-hover)]"
        >
          Try again
        </button>
      </TaskDrawer>
    );
  }

  if (!task || task.id !== taskId) {
    return (
      <TaskDrawer
        task={{ id: taskId, title: "Task unavailable", status: "unknown" }}
        mode={mode}
        onClose={close}
        onRequestClose={requestClose}
        onModeChange={setMode}
      >
        <p className="text-sm text-[color:var(--ega-text-secondary)]">
          This task is not available. It may have been deleted, or the link may be
          wrong.
        </p>
      </TaskDrawer>
    );
  }

  return (
    <TaskDrawer
      task={{ id: task.id, title: task.title, status: task.status }}
      mode={mode}
      onClose={close}
      onRequestClose={requestClose}
      onModeChange={setMode}
    >
      {updateError ? (
        <p role="alert" className="mb-2 text-sm text-[color:var(--status-overdue)]">
          {updateError}
        </p>
      ) : null}
      {updateSuccess ? (
        <p role="status" className="mb-2 text-sm text-[color:var(--status-healthy)]">
          {updateSuccess}
        </p>
      ) : null}
      {favouriteAction ? (
        <form action={favouriteAction} className="mb-2">
          <input type="hidden" name="kind" value="task" />
          <input type="hidden" name="entityId" value={task.id} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <button
            type="submit"
            aria-pressed={isFavourite}
            className="inline-flex items-center gap-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)] hover:text-[color:var(--ega-text)]"
          >
            <Star
              className="h-3.5 w-3.5"
              aria-hidden="true"
              fill={isFavourite ? "currentColor" : "none"}
            />
            {isFavourite ? "Favourited" : "Favourite"}
          </button>
        </form>
      ) : null}

      <TaskDrawerShortcuts
        key={`shortcuts-${task.id}`}
        task={task}
        action={updateDraftAction}
        ownerId={ownerId}
        onMessage={setShortcutMessage}
      />

      {shortcutMessage ? (
        <p role="status" className="mb-2 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
          {shortcutMessage}
        </p>
      ) : null}

      <TaskDrawerDetailForm
        key={task.id}
        task={task}
        action={updateDraftAction}
        returnTo={returnTo}
        onDirtyChange={handleDirtyChange}
      />

      <dl className="mt-4 grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-y-2 text-sm">
        <dt className="text-[color:var(--ega-text-tertiary)]">Status</dt>
        <dd className="flex items-center gap-1.5 text-[color:var(--ega-text)]">
          {isStatus(task.status) ? <StatusIcon status={task.status} decorative /> : null}
          <PropertyField
            action={updateFieldAction}
            taskId={task.id}
            returnTo={returnTo}
            field="status"
            label="Status"
            value={task.status}
            options={KNOWN_STATUSES.filter(
              // Blocked requires a reason, which this stage cannot capture yet;
              // offering it would always fail validation.
              (status) => status !== "blocked" || Boolean(task.blocked_reason),
            ).map((status) => ({ value: status, label: statusLabel(status) }))}
          />
        </dd>
        <dt className="text-[color:var(--ega-text-tertiary)]">Priority</dt>
        <dd className="flex items-center gap-1.5 text-[color:var(--ega-text)]">
          {isPriority(task.priority) ? (
            <PriorityIcon priority={task.priority} decorative />
          ) : null}
          <PropertyField
            action={updateFieldAction}
            taskId={task.id}
            returnTo={returnTo}
            field="priority"
            label="Priority"
            value={task.priority}
            options={KNOWN_PRIORITIES.map((priority) => ({
              value: priority,
              label: formatTaskToken(priority),
            }))}
          />
        </dd>
        <dt className="text-[color:var(--ega-text-tertiary)]">Start</dt>
        <dd className="text-[color:var(--ega-text)]">
          <PropertyField
            action={updateFieldAction}
            taskId={task.id}
            returnTo={returnTo}
            field="startDate"
            label="Start date"
            value={task.start_date ?? ""}
            type="date"
          />
        </dd>
        <dt className="text-[color:var(--ega-text-tertiary)]">Due</dt>
        <dd className="text-[color:var(--ega-text)]">
          <PropertyField
            action={updateFieldAction}
            taskId={task.id}
            returnTo={returnTo}
            field="dueDate"
            label="Due date"
            value={task.due_date ?? ""}
            type="date"
          />
        </dd>
        <dt className="text-[color:var(--ega-text-tertiary)]">Estimate</dt>
        <dd className="text-[color:var(--ega-text)]">
          <PropertyField
            action={updateFieldAction}
            taskId={task.id}
            returnTo={returnTo}
            field="estimateMinutes"
            label="Estimate minutes"
            value={task.estimate_minutes ? String(task.estimate_minutes) : ""}
            type="number"
          />
          <span className="ml-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
            minutes
          </span>
        </dd>
        {task.status === "blocked" ? (
          <>
            <dt className="text-[color:var(--ega-text-tertiary)]">Blocked reason</dt>
            <dd className="text-[color:var(--ega-text)]">
              <PropertyField
                action={updateFieldAction}
                taskId={task.id}
                returnTo={returnTo}
                field="blockedReason"
                label="Blocked reason"
                value={task.blocked_reason ?? ""}
              />
            </dd>
          </>
        ) : null}
      </dl>

      {subtaskActions ? (
        <TaskSubtasks
          taskId={task.id}
          returnTo={returnTo}
          subtasks={subtasks}
          actions={subtaskActions}
        />
      ) : null}

      <TaskAttachmentsSection
        key={`attachments-${task.id}`}
        taskId={task.id}
        attachments={attachments}
        loadError={attachmentsError}
      />

      {commentActions ? (
        <Tabs
          value={activeTab}
          onValueChange={(value) =>
            setActiveTab(value === "activity" ? "activity" : "comments")
          }
          className="mt-5 border-t border-[var(--ega-divider)] pt-4"
        >
          <TabsList
            className="grid grid-cols-2"
            role="group"
            aria-label="Task detail views"
          >
            <TabsTrigger value="comments">
              Comments{comments.length > 0 ? ` ${comments.length}` : ""}
            </TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>
          <TabsContent value="comments">
            <TaskCommentsTab
              taskId={task.id}
              ownerId={ownerId}
              returnTo={returnTo}
              comments={comments}
              mentionCandidates={commentMentions}
              errorMessage={commentsError}
              actions={commentActions}
            />
          </TabsContent>
          <TabsContent value="activity">
            <TaskActivityList items={activity} hasMore={activityHasMore} />
          </TabsContent>
        </Tabs>
      ) : (
        <TaskActivityList items={activity} hasMore={activityHasMore} />
      )}

      <TaskDependencySection
        task={task}
        returnTo={returnTo}
        addAction={addDependencyAction}
        removeAction={removeDependencyAction}
      />
    </TaskDrawer>
  );
}

/**
 * "Blocked by" editor plus the read-only "Blocking" list.
 *
 * The picker is a small fixed-set listbox served by the native select for this
 * stage; dependency edges are informational and never write status or dates.
 */
function TaskDependencySection({
  task,
  returnTo,
  addAction,
  removeAction,
}: {
  task: TaskDrawerDetail;
  returnTo: string;
  addAction: TaskFieldAction;
  removeAction: TaskFieldAction;
}) {
  const detail = task.dependencies;
  const options = detail?.options ?? [];

  return (
    <section className="mt-5 border-t border-[var(--ega-divider)] pt-3" aria-labelledby={`deps-${task.id}`}>
      <h2
        id={`deps-${task.id}`}
        className="text-[length:var(--text-meta)] font-semibold text-[color:var(--ega-text-secondary)]"
      >
        Dependencies
      </h2>
      <p className="mt-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
        Informational only. Adding a dependency never changes status, dates or
        scheduling.
      </p>

      {task.dependencyError ? (
        <p role="alert" className="mt-2 text-[length:var(--text-meta)] text-[color:var(--status-overdue)]">
          {task.dependencyError}
        </p>
      ) : null}

      <h3 className="mt-3 text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
        Blocked by
      </h3>
      {!detail || detail.blockedBy.length === 0 ? (
        <p className="mt-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
          Not blocked by another task.
        </p>
      ) : (
        <ul className="mt-1 flex flex-col gap-1">
          {detail.blockedBy.map((dependency) => (
            <li key={dependency.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span>{dependency.title ?? "Unavailable task"}</span>
              {dependency.startDate || dependency.dueDate ? (
                <span className="text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
                  {dependency.startDate ?? "No start"} – {dependency.dueDate ?? "No due date"}
                </span>
              ) : null}
              <form action={removeAction}>
                <input type="hidden" name="taskId" value={task.id} />
                <input type="hidden" name="blockedByTaskId" value={dependency.id} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <button
                  type="submit"
                  className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)] underline underline-offset-2"
                  aria-label={`Remove dependency on ${dependency.title ?? "unavailable task"}`}
                >
                  Remove
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      {options.length > 0 ? (
        <form action={addAction} className="mt-2 flex flex-wrap items-end gap-2">
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <label className="flex flex-col gap-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
            Add blocked-by task
            <select
              name="blockedByTaskId"
              defaultValue=""
              required
              className="h-8 min-w-[12rem] rounded-[var(--radius-sm)] border border-[var(--ega-border)] bg-[var(--ega-surface)] px-1.5 text-xs text-[color:var(--ega-text)]"
            >
              <option value="" disabled>
                Choose a task
              </option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.title}
                </option>
              ))}
            </select>
          </label>
          <PendingSubmitButton
            type="submit"
            variant="secondary"
            size="sm"
            className="h-8 px-2 text-xs"
            pendingLabel="Adding…"
          >
            Add
          </PendingSubmitButton>
        </form>
      ) : (
        <p className="mt-2 text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
          No other task available to link.
        </p>
      )}

      <h3 className="mt-3 text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
        Blocking
      </h3>
      {!detail || detail.blocking.length === 0 ? (
        <p className="mt-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
          Not blocking another task.
        </p>
      ) : (
        <ul className="mt-1 flex flex-col gap-1">
          {detail.blocking.map((dependency) => (
            <li key={dependency.id} className="text-sm">
              {dependency.title ?? "Unavailable task"}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
