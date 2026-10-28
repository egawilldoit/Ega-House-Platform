"use client";

import {
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import type { TaskCommentMentionCandidateDto } from "@ega/contracts";
import { TASK_COMMENT_BODY_MAX } from "@ega/domain";
import { Kbd } from "@/components/ui/kbd";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import {
  clearTaskCommentDraft,
  readTaskCommentDraft,
  writeTaskCommentDraft,
} from "@/lib/task-comment-draft";
import type { TaskCommentActionResult } from "@/app/tasks/comment-actions";
import { MentionMenu, filterMentionCandidates } from "./mention-menu";

type CommentComposerProps = {
  taskId: string;
  ownerId: string;
  returnTo: string;
  mentionCandidates: TaskCommentMentionCandidateDto[];
  createAction: (
    state: TaskCommentActionResult,
    formData: FormData,
  ) => Promise<TaskCommentActionResult>;
};

const INITIAL_STATE: TaskCommentActionResult = {
  ok: false,
  errorMessage: null,
};

function newRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

type MentionContext = {
  start: number;
  end: number;
  query: string;
};

function findMentionContext(value: string, caret: number): MentionContext | null {
  const before = value.slice(0, caret);
  const match = /(^|[\s([{])@([a-z0-9-]*)$/i.exec(before);
  if (!match) return null;
  const query = match[2] ?? "";
  return {
    start: caret - query.length - 1,
    end: caret,
    query,
  };
}

export function CommentComposer({
  taskId,
  ownerId,
  returnTo,
  mentionCandidates,
  createAction,
}: CommentComposerProps) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const reactId = useId();
  const [requestId, setRequestId] = useState(
    () => `comment-${reactId.replace(/[^A-Za-z0-9_-]/g, "") || "draft"}`,
  );
  const [mention, setMention] = useState<MentionContext | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [state, formAction, pending] = useActionState(createAction, INITIAL_STATE);
  const formRef = useRef<HTMLFormElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const handledRequestRef = useRef<string | null>(null);
  const menuId = `comment-mentions-${taskId}`;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restore the account-scoped browser draft after hydration
    setBody(readTaskCommentDraft(window.localStorage, ownerId, taskId));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- replace the deterministic hydration id with a fresh retry id once mounted
    setRequestId(newRequestId());
  }, [ownerId, taskId]);

  useEffect(() => {
    if (!state.ok || !state.requestId) return;
    if (handledRequestRef.current === state.requestId) return;
    handledRequestRef.current = state.requestId;
    setBody("");
    setMention(null);
    clearTaskCommentDraft(window.localStorage, ownerId, taskId);
    setRequestId(newRequestId());
    router.refresh();
  }, [state, ownerId, taskId, router]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, [body]);

  const visibleMentions = mention
    ? filterMentionCandidates(mentionCandidates, mention.query)
    : [];
  const mentionOpen = Boolean(mention) && visibleMentions.length > 0;

  const updateBody = (value: string, caret: number) => {
    setBody(value);
    writeTaskCommentDraft(window.localStorage, ownerId, taskId, value);
    const context = findMentionContext(value, caret);
    const nextVisible = context
      ? filterMentionCandidates(mentionCandidates, context.query)
      : [];
    setMention(context && nextVisible.length > 0 ? context : null);
    setActiveIndex(0);
  };

  const selectMention = (candidate: TaskCommentMentionCandidateDto) => {
    if (!mention) return;
    const next = `${body.slice(0, mention.start)}@${candidate.handle} ${body.slice(mention.end)}`;
    setBody(next);
    writeTaskCommentDraft(window.localStorage, ownerId, taskId, next);
    setMention(null);
    const caret = mention.start + candidate.handle.length + 2;
    window.setTimeout(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(caret, caret);
    }, 0);
  };

  const submit = () => {
    setMention(null);
    formRef.current?.requestSubmit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;

    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
      return;
    }

    if (mentionOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % visibleMentions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex(
          (index) => (index - 1 + visibleMentions.length) % visibleMentions.length,
        );
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const candidate = visibleMentions[activeIndex];
        if (candidate) selectMention(candidate);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMention(null);
        return;
      }
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (!body.trim() || pending) {
      event.preventDefault();
    }
  };

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={onSubmit}
      className="relative mt-3 border-t border-[var(--ega-divider)] pt-3"
      aria-label="Post a comment"
    >
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <input type="hidden" name="clientRequestId" value={requestId} />

      <label htmlFor={`comment-body-${taskId}`} className="sr-only">
        Comment
      </label>
      <textarea
        ref={textareaRef}
        id={`comment-body-${taskId}`}
        name="body"
        value={body}
        rows={2}
        maxLength={TASK_COMMENT_BODY_MAX}
        placeholder="Add a note, decision or agent hand-off…"
        role="combobox"
        aria-haspopup="listbox"
        aria-keyshortcuts="Meta+Enter Control+Enter"
        aria-autocomplete="list"
        aria-expanded={mentionOpen}
        aria-controls={mentionOpen ? menuId : undefined}
        aria-activedescendant={
          mentionOpen ? `${menuId}-option-${activeIndex}` : undefined
        }
        onChange={(event) =>
          updateBody(event.target.value, event.target.selectionStart ?? 0)
        }
        onKeyDown={onKeyDown}
        onBlur={() => setMention(null)}
        disabled={pending}
        className="input-instrument min-h-[4.5rem] w-full resize-none px-2.5 py-2 text-sm"
      />

      {mentionOpen ? (
        <MentionMenu
          id={menuId}
          candidates={mentionCandidates}
          query={mention?.query ?? ""}
          activeIndex={activeIndex}
          onActiveIndexChange={setActiveIndex}
          onSelect={selectMention}
        />
      ) : null}

      {state.errorMessage ? (
        <p role="alert" className="mt-1 text-[length:var(--text-meta)] text-[color:var(--status-overdue)]">
          {state.errorMessage}
        </p>
      ) : null}

      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
          <Kbd>Ctrl</Kbd>
          <span>/</span>
          <Kbd>⌘</Kbd>
          <span>+</span>
          <Kbd>Enter</Kbd>
          <span>to send</span>
        </p>
        <PendingSubmitButton
          type="submit"
          size="sm"
          pendingLabel="Posting…"
          disabled={!body.trim() || pending}
        >
          Comment
        </PendingSubmitButton>
      </div>
    </form>
  );
}
