"use client";

import { Check } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type MenuListItem = {
  id: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  disabled?: boolean;
};

type MenuListProps = {
  items: MenuListItem[];
  /** Currently selected item id, if the list represents a single value. */
  value?: string | null;
  onSelect: (item: MenuListItem) => void;
  /** Accessible name for the listbox. */
  label: string;
  /** Announced when `items` is empty. */
  emptyMessage?: string;
  className?: string;
  /** Id prefix for option elements; one is generated when omitted. */
  idPrefix?: string;
  /**
   * Move focus to the list on mount. Defaults to false: a popover already owns
   * open-focus, and an inline list must not steal focus from the page.
   */
  autoFocus?: boolean;
};

/**
 * Keyboard-first option list with listbox semantics.
 *
 * Deliberately a **listbox**, not a combobox: the pickers this serves are small
 * fixed sets (status, priority, project), where an always-visible text box
 * would add a mode switch. Type-ahead (first letters of a label) replaces
 * filtering. A picker that needs real search must be built as a combobox.
 *
 * Keyboard: ArrowUp/Down move, Home/End jump, Enter/Space select, Esc dismisses
 * through the surrounding popover. Focus stays on the listbox and the active
 * option is announced with `aria-activedescendant`.
 */
export function MenuList({
  items,
  value = null,
  onSelect,
  label,
  emptyMessage = "No options",
  className,
  idPrefix,
  autoFocus = false,
}: MenuListProps) {
  const generatedPrefix = useId();
  const prefix = idPrefix ?? generatedPrefix;
  const optionId = (itemId: string) => `${prefix}-option-${itemId}`;

  // Tracking the active item by id (not index) means a shrinking or reordered
  // option set can never leave `aria-activedescendant` pointing at nothing.
  const [activeId, setActiveId] = useState<string | null>(() => {
    const selected = items.find((item) => item.id === value && !item.disabled);
    return (selected ?? items.find((item) => !item.disabled))?.id ?? null;
  });
  // Derive the active row defensively: the remembered id can disappear, or the
  // option can become disabled, when a consumer swaps the option set. Falling
  // back to `items[0]` would let aria-activedescendant name a disabled row.
  const remembered = items.find((item) => item.id === activeId);
  const activeItem =
    remembered && !remembered.disabled
      ? remembered
      : (items.find((item) => !item.disabled) ?? null);
  const activeIndex = activeItem ? items.indexOf(activeItem) : 0;
  const activeItemId = activeItem?.id ?? null;
  const listRef = useRef<HTMLDivElement>(null);
  const typeAhead = useRef<{ buffer: string; timer: ReturnType<typeof setTimeout> | null }>({
    buffer: "",
    timer: null,
  });

  useEffect(() => {
    if (autoFocus) listRef.current?.focus();
  }, [autoFocus]);

  // `aria-activedescendant` is the only visible focus indicator here, so the
  // active row must stay inside the scroll viewport (WCAG 2.4.7).
  useEffect(() => {
    if (!activeItemId) return;
    // Ids come from `useId` and contain characters that need escaping in a CSS
    // selector, so match by attribute value instead of building a selector.
    const targetId = `${prefix}-option-${activeItemId}`;
    const option = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [],
    ).find((element) => element.id === targetId);
    option?.scrollIntoView?.({ block: "nearest" });
  }, [activeItemId, prefix]);

  useEffect(
    () => () => {
      if (typeAhead.current.timer) clearTimeout(typeAhead.current.timer);
    },
    [],
  );

  const moveTo = (index: number) => {
    const next = items[index];
    if (next) setActiveId(next.id);
  };

  const findEnabled = (from: number, step: 1 | -1) => {
    for (let offset = 1; offset <= items.length; offset += 1) {
      const candidate = ((from + step * offset) % items.length + items.length) % items.length;
      if (!items[candidate]?.disabled) return candidate;
    }
    return from;
  };

  const handleTypeAhead = (key: string) => {
    const state = typeAhead.current;
    const lower = key.toLowerCase();
    const fresh = state.buffer.length === 0;
    if (state.timer) clearTimeout(state.timer);
    // A repeated character keeps a one-character buffer so the second press
    // cycles to that character's next match instead of building an impossible
    // prefix like "dd".
    state.buffer = !fresh && state.buffer.endsWith(lower) ? lower : state.buffer + lower;
    state.timer = setTimeout(() => {
      typeAhead.current.buffer = "";
      typeAhead.current.timer = null;
    }, 500);

    const matches = items.filter(
      (item) => !item.disabled && item.label.toLowerCase().startsWith(state.buffer),
    );
    if (matches.length === 0) return;
    if (fresh) {
      setActiveId(matches[0].id);
      return;
    }
    // Repeating one letter cycles through that letter's options instead of
    // re-selecting the first match every time.
    const currentIndex = matches.findIndex((item) => item.id === activeId);
    setActiveId(matches[(currentIndex + 1) % matches.length].id);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveTo(findEnabled(activeIndex, 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveTo(findEnabled(activeIndex, -1));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      moveTo(findEnabled(-1, 1));
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      moveTo(findEnabled(items.length, -1));
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (activeItem && !activeItem.disabled) onSelect(activeItem);
      return;
    }
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      handleTypeAhead(event.key);
    }
  };

  if (items.length === 0) {
    return (
      <div className={cn("px-2 py-3 text-xs text-[color:var(--ega-text-tertiary)]", className)}>
        {emptyMessage}
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label={label}
      aria-activedescendant={activeItem ? optionId(activeItem.id) : undefined}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className={cn("max-h-[min(18rem,50vh)] overflow-y-auto focus:outline-none", className)}
    >
      {items.map((item) => {
        const isActive = activeItem === item;
        const isSelected = item.id === value;
        return (
          <div
            key={item.id}
            id={optionId(item.id)}
            role="option"
            aria-describedby={item.description ? `${optionId(item.id)}-description` : undefined}
            aria-selected={isSelected}
            aria-disabled={item.disabled || undefined}
            onMouseEnter={() => {
              if (!item.disabled) setActiveId(item.id);
            }}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              if (!item.disabled) onSelect(item);
            }}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-sm",
              isActive && "bg-[var(--ega-surface-hover)]",
              isSelected && "font-medium text-[color:var(--ega-text)]",
              !isSelected && "text-[color:var(--ega-text-secondary)]",
              item.disabled && "cursor-not-allowed opacity-50",
            )}
          >
            {item.icon ? (
              <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center">
                {item.icon}
              </span>
            ) : null}
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.description ? (
              <span
                id={`${optionId(item.id)}-description`}
                aria-hidden="true"
                className="shrink-0 text-xs text-[color:var(--ega-text-tertiary)]"
              >
                {item.description}
              </span>
            ) : null}
            {isSelected ? (
              <Check aria-hidden="true" className="size-3.5 text-[color:var(--ega-text-tertiary)]" />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
