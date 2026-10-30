import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

import type { HomeDeadlineBucket } from "../_lib/home-page-model";
import { HomeTaskPreviewRow } from "./home-task-row";

function bucketLabel(bucket: HomeDeadlineBucket) {
  const scope =
    bucket.key === "thisWeek" ? "This week (next 7 days)" : bucket.label;

  return bucket.count === null
    ? `${scope} deadlines unavailable. Open the filtered task list.`
    : `${scope} deadlines: ${bucket.count} task${bucket.count === 1 ? "" : "s"}. Open the filtered task list.`;
}

function DeadlineBucket({ bucket }: { bucket: HomeDeadlineBucket }) {
  const sectionId = `home-deadline-${bucket.key}`;
  const hasMore = bucket.count !== null && bucket.count > bucket.tasks.length;

  return (
    <section aria-labelledby={sectionId} data-testid={`home-deadline-${bucket.key}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 id={sectionId} className="text-[length:var(--text-meta-lg)] font-semibold text-[color:var(--ega-text)]">
          <Link
            href={bucket.href}
            aria-label={bucketLabel(bucket)}
            className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] hover:text-[color:var(--ega-text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ega-accent)]"
          >
            {bucket.label}
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </h3>
        {bucket.count === null ? (
          <span className="text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
            &mdash;
          </span>
        ) : (
          <Badge tone={bucket.count === 0 ? "muted" : "info"}>{bucket.count}</Badge>
        )}
      </div>

      {bucket.count === null ? (
        <p className="py-2 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
          Unavailable right now.
        </p>
      ) : bucket.tasks.length === 0 ? (
        <p className="py-2 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
          Nothing due
        </p>
      ) : (
        <div className="mt-1 flex flex-col">
          {bucket.tasks.map((task) => (
            <HomeTaskPreviewRow key={task.id} task={task} />
          ))}
        </div>
      )}

      {hasMore ? (
        <Link
          href={bucket.href}
          className="mt-1 inline-flex items-center gap-1 text-[length:var(--text-meta)] font-medium text-[color:var(--ega-text-secondary)] underline-offset-4 hover:text-[color:var(--ega-text)] hover:underline"
        >
          View all {bucket.count}
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      ) : null}
    </section>
  );
}

/**
 * Deadline buckets from real EGA due dates. Today/Tomorrow/This week are
 * non-overlapping canonical date windows; each bucket links to the Tasks URL
 * filter with the identical scope and shows an exact total even when only a
 * bounded preview is rendered.
 */
export function HomeDeadlinesPanel({ buckets }: { buckets: HomeDeadlineBucket[] }) {
  return (
    <Card title="Deadlines" data-testid="home-deadlines">
      <CardContent className="flex flex-col gap-4">
        {buckets.map((bucket) => (
          <DeadlineBucket key={bucket.key} bucket={bucket} />
        ))}
      </CardContent>
    </Card>
  );
}
