import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDown, ArrowUp, Star } from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { listFavorites, type FavoriteItem } from "@/lib/services/favorite-service";
import { moveFavoriteAction, toggleFavoriteAction } from "./actions";

export const metadata: Metadata = {
  title: "Favourites",
  description: "Starred projects and tasks for quick navigation.",
};

export const dynamic = "force-dynamic";

function FavouriteRow({ item, index, count }: { item: FavoriteItem; index: number; count: number }) {
  return (
    <li className={`row ${item.archived ? "opacity-60" : ""}`}>
      <span className="row-main">
        <Link href={item.href} className="row-title hover:underline">
          {item.label}
        </Link>
        <span className="row-meta">
          {item.kind === "project" ? "Project" : "Task"}
          {item.subtitle ? ` · ${item.subtitle}` : ""}
          {item.archived ? " · Archived" : ""}
        </span>
      </span>
      <span className="row-actions flex items-center gap-1">
        <form action={moveFavoriteAction}>
          <input type="hidden" name="kind" value={item.kind} />
          <input type="hidden" name="entityId" value={item.entityId} />
          <input type="hidden" name="direction" value="up" />
          <button
            type="submit"
            disabled={index === 0}
            aria-label={`Move ${item.label} up`}
            className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-xs)] text-[color:var(--ega-text-secondary)] transition-colors hover:bg-[var(--ega-surface-hover)] hover:text-[color:var(--ega-text)] focus-visible:outline-none focus-visible:shadow-[var(--ega-focus-ring)] disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </form>
        <form action={moveFavoriteAction}>
          <input type="hidden" name="kind" value={item.kind} />
          <input type="hidden" name="entityId" value={item.entityId} />
          <input type="hidden" name="direction" value="down" />
          <button
            type="submit"
            disabled={index === count - 1}
            aria-label={`Move ${item.label} down`}
            className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-xs)] text-[color:var(--ega-text-secondary)] transition-colors hover:bg-[var(--ega-surface-hover)] hover:text-[color:var(--ega-text)] focus-visible:outline-none focus-visible:shadow-[var(--ega-focus-ring)] disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </form>
        <form action={toggleFavoriteAction}>
          <input type="hidden" name="kind" value={item.kind} />
          <input type="hidden" name="entityId" value={item.entityId} />
          <input type="hidden" name="returnTo" value="/favorites" />
          <button
            type="submit"
            aria-label={`Remove ${item.label} from favourites`}
            className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-xs)] text-[color:var(--status-risk)] transition-colors hover:bg-[var(--status-risk-bg)] focus-visible:outline-none focus-visible:shadow-[var(--ega-focus-ring)]"
          >
            <Star className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
          </button>
        </form>
      </span>
    </li>
  );
}

export default async function FavoritesPage({
  searchParams,
}: {
  searchParams: Promise<{ actionError?: string; actionSuccess?: string }>;
}) {
  const [{ items }, params] = await Promise.all([listFavorites(), searchParams]);
  const projects = items.filter((item) => item.kind === "project");
  const tasks = items.filter((item) => item.kind === "task");

  return (
    <AppShell title="Favourites" description="Starred projects and tasks for quick navigation.">
      {params.actionError ? (
        <p role="alert" className="feedback-block feedback-block-error mb-4">
          {params.actionError.slice(0, 180)}
        </p>
      ) : null}
      {params.actionSuccess ? (
        <p role="status" className="feedback-block mb-4">
          {params.actionSuccess.slice(0, 180)}
        </p>
      ) : null}

      {items.length === 0 ? (
        <Card>
          <EmptyState
            icon={Star}
            title="No favourites yet"
            description="Star a project or task from its page to keep it here."
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {projects.length > 0 ? (
            <Card label="Favourites" title="Projects">
              <ul className="rows">
                {projects.map((item, index) => (
                  <FavouriteRow
                    key={item.favoriteId}
                    item={item}
                    index={index}
                    count={projects.length}
                  />
                ))}
              </ul>
            </Card>
          ) : null}
          {tasks.length > 0 ? (
            <Card label="Favourites" title="Tasks">
              <ul className="rows">
                {tasks.map((item, index) => (
                  <FavouriteRow
                    key={item.favoriteId}
                    item={item}
                    index={index}
                    count={tasks.length}
                  />
                ))}
              </ul>
            </Card>
          ) : null}
          <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
            Favourites are navigation shortcuts, separate from Today focus pins. Archived
            entities stay hidden here and reappear when restored.
          </p>
        </div>
      )}
    </AppShell>
  );
}
