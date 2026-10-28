"use client";

import { Check, ChevronsDownUp, ChevronsUpDown, ListOrdered, MoreHorizontal, Plus } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { TaskBoardOrder } from "@/lib/task-list";

type KanbanColumnMenuProps = {
  status: string;
  label: string;
  taskCount: number;
  completedCount: number;
  collapsed: boolean;
  boardOrder: TaskBoardOrder | null;
  disabled?: boolean;
  onAddTask: () => void;
  onToggleCollapse: () => void;
  onSort: (order: TaskBoardOrder) => void;
  onMarkAllDone: () => void;
  onArchiveCompleted: () => void;
};

/**
 * Column header menu. Every item maps to an existing action:
 * quick-create, the board-local order contract, or the EGA-786 bulk contract.
 */
export function KanbanColumnMenu({
  status,
  label,
  taskCount,
  completedCount,
  collapsed,
  boardOrder,
  disabled = false,
  onAddTask,
  onToggleCollapse,
  onSort,
  onMarkAllDone,
  onArchiveCompleted,
}: KanbanColumnMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[color:var(--ega-text-tertiary)] transition-colors hover:bg-[var(--ega-surface-hover)] hover:text-[color:var(--ega-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ega-accent)]"
          aria-label={`${label} column actions`}
          data-testid={`kanban-column-menu-${status}`}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent aria-label={`${label} column actions`}>
        <DropdownMenuItem onSelect={onAddTask}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add task here
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onToggleCollapse}>
          {collapsed ? (
            <ChevronsUpDown className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ChevronsDownUp className="h-4 w-4" aria-hidden="true" />
          )}
          {collapsed ? "Expand column" : "Collapse column"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => onSort("priority")}
          aria-label={`Sort ${label} by priority`}
        >
          {boardOrder === "priority" ? (
            <Check className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ListOrdered className="h-4 w-4" aria-hidden="true" />
          )}
          Sort by priority
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onSort("manual")}>
          {boardOrder === "manual" ? (
            <Check className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ListOrdered className="h-4 w-4" aria-hidden="true" />
          )}
          Manual order
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={disabled || taskCount === 0}
          onSelect={onMarkAllDone}
        >
          <Check className="h-4 w-4" aria-hidden="true" />
          Mark all done
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={disabled || completedCount === 0}
          onSelect={onArchiveCompleted}
        >
          <ChevronsDownUp className="h-4 w-4" aria-hidden="true" />
          Archive completed
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
