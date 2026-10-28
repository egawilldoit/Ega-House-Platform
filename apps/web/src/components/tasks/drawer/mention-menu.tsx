"use client";

import type { TaskCommentMentionCandidateDto } from "@ega/contracts";
import { cn } from "@/lib/utils";

type MentionMenuProps = {
  id: string;
  candidates: TaskCommentMentionCandidateDto[];
  query: string;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onSelect: (candidate: TaskCommentMentionCandidateDto) => void;
};

export function filterMentionCandidates(
  candidates: TaskCommentMentionCandidateDto[],
  query: string,
): TaskCommentMentionCandidateDto[] {
  const normalized = query.trim().toLowerCase();
  return candidates
    .filter((candidate) => {
      if (!normalized) return true;
      return (
        candidate.handle.toLowerCase().includes(normalized) ||
        candidate.label.toLowerCase().includes(normalized)
      );
    })
    .slice(0, 8);
}

/**
 * `@` autocomplete for the composer.
 *
 * This is a combobox listbox: the textarea owns `aria-activedescendant` and the
 * arrow/Enter keys; the menu itself only presents the authorized candidates.
 */
export function MentionMenu({
  id,
  candidates,
  query,
  activeIndex,
  onActiveIndexChange,
  onSelect,
}: MentionMenuProps) {
  const visible = filterMentionCandidates(candidates, query);

  if (visible.length === 0) return null;

  return (
    <div
      id={id}
      role="listbox"
      aria-label="Mention suggestions"
      className="absolute bottom-full left-0 z-20 mb-1 w-full max-w-xs overflow-hidden rounded-[var(--radius-md)] border border-[var(--ega-border)] bg-[var(--ega-surface)] shadow-[var(--ega-shadow-md)]"
    >
      {visible.map((candidate, index) => (
        <button
          key={candidate.ref}
          type="button"
          role="option"
          id={`${id}-option-${index}`}
          aria-selected={index === activeIndex}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onSelect(candidate)}
          onMouseEnter={() => onActiveIndexChange(index)}
          className={cn(
            "flex w-full items-center justify-between gap-3 px-2.5 py-1.5 text-left text-[length:var(--text-meta-lg)]",
            index === activeIndex
              ? "bg-[var(--ega-surface-hover)] text-[color:var(--ega-text)]"
              : "text-[color:var(--ega-text-secondary)]",
          )}
        >
          <span className="truncate">
            <span className="font-medium">@{candidate.handle}</span>{" "}
            <span className="text-[color:var(--ega-text-tertiary)]">
              {candidate.label}
            </span>
          </span>
          <span className="shrink-0 text-[length:var(--text-meta)] uppercase tracking-[0.06em] text-[color:var(--ega-text-tertiary)]">
            {candidate.kind === "owner" ? "Owner" : "Agent"}
          </span>
        </button>
      ))}
    </div>
  );
}
