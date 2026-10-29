"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  TaskCommentDto,
  TaskCommentMentionCandidateDto,
} from "@ega/contracts";

import type {
  TaskCommentActionResult,
  TaskCommentReactionActionResult,
} from "@/app/tasks/comment-actions";
import { TASK_COMMENT_BODY_MAX } from "@ega/domain";
import { CommentComposer } from "./comment-composer";
import { ReactionBar } from "./reaction-bar";
import { TaskCommentBody } from "./task-comment-body";

export type TaskCommentActionSet = {
  createAction: (
    state: TaskCommentActionResult,
    formData: FormData,
  ) => Promise<TaskCommentActionResult>;
  updateAction: (formData: FormData) => Promise<TaskCommentActionResult>;
  deleteAction: (formData: FormData) => Promise<TaskCommentActionResult>;
  toggleReactionAction: (
    formData: FormData,
  ) => Promise<TaskCommentReactionActionResult>;
};

type TaskCommentsTabProps = {
  taskId: string;
  ownerId: string | null;
  returnTo: string;
  comments: TaskCommentDto[];
  mentionCandidates: TaskCommentMentionCandidateDto[];
  errorMessage?: string | null;
  actions: TaskCommentActionSet;
};

function formatCommentTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function authorName(comment: TaskCommentDto) {
  return comment.author.kind === "owner" ? "You" : comment.author.label;
}

export function TaskCommentsTab({
  taskId,
  ownerId,
  returnTo,
  comments,
  mentionCandidates,
  errorMessage = null,
  actions,
}: TaskCommentsTabProps) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const saveEdit = (commentId: string) => {
    if (!editBody.trim()) {
      setActionError("A comment is required.");
      return;
    }
    setActionError(null);
    setPendingId(commentId);
    const formData = new FormData();
    formData.set("commentId", commentId);
    formData.set("taskId", taskId);
    formData.set("returnTo", returnTo);
    formData.set("body", editBody);

    startTransition(async () => {
      const result = await actions.updateAction(formData);
      setPendingId(null);
      if (!result.ok) {
        setActionError(result.errorMessage ?? "Unable to save the comment right now.");
        return;
      }
      setEditingId(null);
      router.refresh();
    });
  };

  const deleteComment = (comment: TaskCommentDto) => {
    if (!window.confirm("Delete this comment?")) return;
    setActionError(null);
    setPendingId(comment.id);
    const formData = new FormData();
    formData.set("commentId", comment.id);
    formData.set("taskId", taskId);
    formData.set("returnTo", returnTo);

    startTransition(async () => {
      const result = await actions.deleteAction(formData);
      setPendingId(null);
      if (!result.ok) {
        setActionError(result.errorMessage ?? "Unable to delete the comment right now.");
        return;
      }
      router.refresh();
    });
  };

  return (
    <section aria-label="Comments">
      {errorMessage ? (
        <p role="alert" className="mt-3 text-sm text-[color:var(--status-overdue)]">
          {errorMessage}
        </p>
      ) : null}

      {actionError ? (
        <p role="alert" className="mt-3 text-sm text-[color:var(--status-overdue)]">
          {actionError}
        </p>
      ) : null}

      {comments.length === 0 ? (
        <div className="mt-3 rounded-[var(--radius-sm)] border border-dashed border-[var(--ega-border)] px-3 py-4">
          <p className="text-sm text-[color:var(--ega-text-secondary)]">
            No comments yet. Start the thread with a note, decision or agent hand-off.
          </p>
        </div>
      ) : (
        <ol className="mt-3 flex flex-col gap-3">
          {comments.map((comment) => {
            const isEditing = editingId === comment.id;
            const isPending = pendingId === comment.id;

            return (
              <li
                key={comment.id}
                className="rounded-[var(--radius-sm)] border border-[var(--ega-divider)] px-3 py-2.5"
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-sm font-medium text-[color:var(--ega-text)]">
                    {authorName(comment)}
                  </span>
                  {comment.author.kind === "agent" ? (
                    <span className="rounded-[var(--radius-pill)] bg-[var(--ega-surface-hover)] px-1.5 text-[10px] uppercase tracking-[0.06em] text-[color:var(--ega-text-tertiary)]">
                      Agent
                    </span>
                  ) : null}
                  <time
                    dateTime={comment.createdAt}
                    className="text-[length:var(--text-meta)] tabular-nums text-[color:var(--ega-text-tertiary)]"
                  >
                    {formatCommentTime(comment.createdAt)}
                  </time>
                  {comment.editedAt ? (
                    <span className="text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
                      · edited
                    </span>
                  ) : null}
                </div>

                {isEditing ? (
                  <div className="mt-1.5">
                    <textarea
                      value={editBody}
                      maxLength={TASK_COMMENT_BODY_MAX}
                      rows={3}
                      aria-label={`Edit comment by ${authorName(comment)}`}
                      onChange={(event) => setEditBody(event.target.value)}
                      className="input-instrument w-full resize-y px-2.5 py-2 text-sm"
                    />
                    <div className="mt-1.5 flex items-center gap-2">
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => saveEdit(comment.id)}
                        className="inline-flex h-7 items-center rounded-[var(--radius-sm)] bg-[var(--ega-ink)] px-2.5 text-xs font-medium text-[color:var(--ega-surface)] disabled:opacity-60"
                      >
                        {isPending ? "Saving…" : "Save"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(null);
                          setActionError(null);
                        }}
                        className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)] underline-offset-2 hover:underline"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-1">
                    <TaskCommentBody body={comment.body} mentions={comment.mentions} />
                  </div>
                )}

                {!isEditing ? (
                  <ReactionBar
                    key={`${comment.id}-${comment.reactions
                      .map((reaction) => `${reaction.emoji}:${reaction.count}:${reaction.reactedByViewer ? 1 : 0}`)
                      .join(",")}`}
                    commentId={comment.id}
                    taskId={taskId}
                    returnTo={returnTo}
                    reactions={comment.reactions}
                    toggleAction={actions.toggleReactionAction}
                  />
                ) : null}

                {comment.viewerCanEdit || comment.viewerCanDelete ? (
                  <div className="mt-1 flex items-center gap-2">
                    {comment.viewerCanEdit ? (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(comment.id);
                          setEditBody(comment.body);
                          setActionError(null);
                        }}
                        className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)] underline-offset-2 hover:underline"
                      >
                        Edit
                      </button>
                    ) : null}
                    {comment.viewerCanDelete ? (
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => deleteComment(comment)}
                        className="text-[length:var(--text-meta)] text-[color:var(--status-overdue)] underline-offset-2 hover:underline disabled:opacity-60"
                      >
                        {isPending ? "Deleting…" : "Delete"}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      {ownerId ? (
        <CommentComposer
          key={`${ownerId}-${taskId}`}
          taskId={taskId}
          ownerId={ownerId}
          returnTo={returnTo}
          mentionCandidates={mentionCandidates}
          createAction={actions.createAction}
        />
      ) : null}
    </section>
  );
}
