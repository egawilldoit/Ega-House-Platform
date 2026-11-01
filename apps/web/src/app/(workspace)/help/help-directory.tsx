"use client";

import { useMemo, useState } from "react";
import { Search, SearchX } from "lucide-react";

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";

export type HelpEntry = {
  id: string;
  title: string;
  detail: string;
  combo?: string;
};

export type HelpGroup = {
  id: string;
  title: string;
  description: string;
  entries: HelpEntry[];
};

type HelpDirectoryProps = {
  groups: HelpGroup[];
};

function matchesQuery(entry: HelpEntry, query: string) {
  const haystack = `${entry.title} ${entry.detail} ${entry.combo ?? ""}`.toLowerCase();
  return haystack.includes(query);
}

export function HelpDirectory({ groups }: HelpDirectoryProps) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();

  const filteredGroups = useMemo(() => {
    if (!normalizedQuery) {
      return groups;
    }

    return groups
      .map((group) => ({
        ...group,
        entries: group.entries.filter((entry) => matchesQuery(entry, normalizedQuery)),
      }))
      .filter((group) => group.entries.length > 0);
  }, [groups, normalizedQuery]);

  const matchCount = filteredGroups.reduce(
    (total, group) => total + group.entries.length,
    0,
  );
  const totalCount = groups.reduce((total, group) => total + group.entries.length, 0);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center gap-3 px-[18px] py-3">
          <label className="relative flex min-w-[220px] flex-1 items-center">
            <span className="sr-only">Search help</span>
            <Search
              className="pointer-events-none absolute left-3 h-4 w-4 text-ega-text-tertiary"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search help topics"
              className="h-9 w-full pl-9"
            />
          </label>
          <p
            aria-live="polite"
            className="text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]"
          >
            {normalizedQuery
              ? `${matchCount} of ${totalCount} topics`
              : `${totalCount} topics`}
          </p>
        </div>
      </Card>

      {filteredGroups.length === 0 ? (
        <Card>
          <EmptyState
            icon={SearchX}
            title="No matching topics"
            description="Try a different search term, or clear the search to browse every help topic."
          />
        </Card>
      ) : (
        filteredGroups.map((group) => (
          <Card key={group.id}>
            <CardHeader>
              <CardTitle>{group.title}</CardTitle>
              <CardDescription>{group.description}</CardDescription>
            </CardHeader>
            <ul className="rows">
              {group.entries.map((entry) => (
                <li key={entry.id} className="row">
                  <span className="row-main">
                    <span className="row-title">{entry.title}</span>
                    <span className="row-meta">{entry.detail}</span>
                  </span>
                  {entry.combo ? (
                    <kbd className="mt-0.5 shrink-0 self-start rounded-[var(--radius-xs)] border border-ega-border bg-ega-surface-subtle px-2 py-1 text-[length:var(--text-micro)] font-semibold uppercase tracking-[var(--tracking-widest)] text-ega-text-secondary">
                      {entry.combo}
                    </kbd>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}
    </div>
  );
}
