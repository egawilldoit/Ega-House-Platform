"use client";

import { useState, useTransition } from "react";
import type { TaskCommentReaction } from "@ega/contracts";
import { SmilePlus } from "lucide-react";
import { TASK_COMMENT_REACTION_EMOJIS } from "@ega/domain";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { TaskCommentReactionActionResult } from "@/app/tasks/comment-actions";

type ReactionBarProps = {
  commentId: string;
  returnTo: string;
  reactions: TaskCommentReaction[];
  toggleAction: (formData: FormData) => Promise<TaskCommentReactionActionResult>;
  onReactions: (reactions: TaskCommentReaction[]) => void;
};

export function ReactionBar({
  commentId,
  returnTo,
  reactions,
  toggleAction,
  onReactions,
}: ReactionBarProps) {
  const [pendingEmoji, setPendingEmoji] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const toggle = (emoji: string) => {
    setPendingEmoji(emoji);
    setErrorMessage(null);
    const formData = new FormData();
    formData.set("commentId", commentId);
    formData.set("returnTo", returnTo);
    formData.set("emoji", emoji);

    startTransition(async () => {
      const result = await toggleAction(formData);
      setPendingEmoji(null);
      if (!result.ok || !result.reactions) {
        setErrorMessage(result.errorMessage ?? "Unable to update the reaction right now.");
        return;
      }
      onReactions(result.reactions);
    });
  };

  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap items-center gap-1">
        {reactions.map((reaction) => (
          <button
            key={reaction.emoji}
            type="button"
            aria-pressed={reaction.reactedByViewer}
            aria-label={`${reaction.reactedByViewer ? "Remove" : "Add"} ${reaction.emoji} reaction, ${reaction.count} total`}
            disabled={pendingEmoji !== null}
            onClick={() => toggle(reaction.emoji)}
            className={cn(
              "inline-flex h-7 min-w-7 items-center gap-1 rounded-[var(--radius-pill)] border px-1.5 text-[length:var(--text-meta)] tabular-nums",
              reaction.reactedByViewer
                ? "border-[var(--ega-accent)] bg-[var(--ega-accent-soft)] text-[color:var(--ega-accent)]"
                : "border-[var(--ega-border)] text-[color:var(--ega-text-secondary)] hover:bg-[var(--ega-surface-hover)]",
              pendingEmoji === reaction.emoji && "opacity-60",
            )}
          >
            <span aria-hidden="true">{reaction.emoji}</span>
            <span>{reaction.count}</span>
          </button>
        ))}

        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Add a reaction"
              className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-pill)] text-[color:var(--ega-text-tertiary)] hover:bg-[var(--ega-surface-hover)] hover:text-[color:var(--ega-text-secondary)]"
            >
              <SmilePlus className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-1.5">
            <div className="flex items-center gap-1" role="group" aria-label="Reaction picker">
              {TASK_COMMENT_REACTION_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  aria-label={`React with ${emoji}`}
                  disabled={pendingEmoji !== null}
                  onClick={() => toggle(emoji)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-base hover:bg-[var(--ega-surface-hover)]"
                >
                  <span aria-hidden="true">{emoji}</span>
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>
      {errorMessage ? (
        <p role="alert" className="mt-1 text-[length:var(--text-meta)] text-[color:var(--status-overdue)]">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
