"use client";

import { useId } from "react";
import Link from "next/link";
import { Check } from "lucide-react";

import { Input } from "@/components/ui/input";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type TableViewFilterValues = {
  status: string | null;
  project: string | null;
  goal: string | null;
  due: string;
  sort: string;
  priority: string;
  estimateMin: string | number | null;
  estimateMax: string | number | null;
  dueWithin: string | number | null;
  activeTasks: boolean;
};

export type TableViewLink = {
  id: string;
  name: string;
  href: string;
  isDefault?: boolean;
};

type TableViewMenuProps = {
  savedViews: readonly TableViewLink[];
  createAction: (formData: FormData) => void | Promise<void>;
  returnTo: string;
  filters: TableViewFilterValues;
  columnsParam: string | null;
  widthsParam: string | null;
};

/**
 * Compact view switcher for the table.
 *
 * The table's column layout travels in `cols`/`widths`, so saving a view here
 * persists both the filters and the column configuration in one place. The
 * fuller saved-view manager remains a separate component; this menu is the
 * in-table path required to make column configuration durable per view.
 */
export function TableViewMenu({
  savedViews,
  createAction,
  returnTo,
  filters,
  columnsParam,
  widthsParam,
}: TableViewMenuProps) {
  const nameId = useId();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="filter-pill"
          data-testid="table-views-trigger"
          aria-haspopup="dialog"
        >
          Views
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" role="dialog" aria-label="Views" className="w-[min(20rem,calc(100vw-1rem))] p-2">
        <p className="px-1 pb-1 text-[length:var(--text-meta)] font-semibold uppercase tracking-[var(--tracking-wide)] text-[color:var(--ega-text-tertiary)]">
          Views
        </p>

        {savedViews.length > 0 ? (
          <ul className="flex flex-col" aria-label="Saved views">
            {savedViews.map((view) => (
              <li key={view.id}>
                <Link
                  href={view.href}
                  scroll={false}
                  className="flex min-h-8 items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-sm text-[color:var(--ega-text-secondary)] outline-none hover:bg-[var(--ega-surface-hover)] hover:text-[color:var(--ega-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ega-focus-outline)]"
                >
                  <span className="min-w-0 flex-1 truncate">{view.name}</span>
                  {view.isDefault ? (
                    <span className="shrink-0 text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-wide)] text-[color:var(--ega-text-tertiary)]">
                      Built-in
                    </span>
                  ) : null}
                  {view.href === returnTo ? (
                    <Check aria-hidden="true" className="size-3.5 shrink-0" />
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-1 py-2 text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
            No views yet.
          </p>
        )}

        <form
          action={createAction}
          className="mt-2 flex flex-col gap-2 border-t border-[var(--ega-divider)] pt-2"
        >
          <input type="hidden" name="returnTo" value={returnTo} />
          <input type="hidden" name="status" value={filters.status ?? ""} />
          <input type="hidden" name="project" value={filters.project ?? ""} />
          <input type="hidden" name="goal" value={filters.goal ?? ""} />
          <input type="hidden" name="due" value={filters.due} />
          <input type="hidden" name="sort" value={filters.sort} />
          <input type="hidden" name="priority" value={filters.priority} />
          <input type="hidden" name="estimateMin" value={filters.estimateMin ?? ""} />
          <input type="hidden" name="estimateMax" value={filters.estimateMax ?? ""} />
          <input type="hidden" name="dueWithin" value={filters.dueWithin ?? ""} />
          <input type="hidden" name="tasks" value={filters.activeTasks ? "active" : ""} />
          <input type="hidden" name="cols" value={columnsParam ?? ""} />
          <input type="hidden" name="widths" value={widthsParam ?? ""} />

          <label htmlFor={nameId} className="sr-only">
            View name
          </label>
          <Input
            id={nameId}
            name="name"
            maxLength={80}
            placeholder="Name this view"
            className="h-8 px-2.5 text-[length:var(--text-meta-lg)]"
          />
          <PendingSubmitButton type="submit" size="sm" pendingLabel="Saving…">
            Save current view
          </PendingSubmitButton>
        </form>
      </PopoverContent>
    </Popover>
  );
}
