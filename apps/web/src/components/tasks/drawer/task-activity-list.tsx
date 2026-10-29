import {
  taskActivityActorLabel,
  type TaskActivityItem,
} from "@/lib/task-activity";

function formatActivityTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

/**
 * Append-only activity for the selected task: status ledger, field changes,
 * reminders and timer evidence in one deterministic order. Actor attribution
 * only claims what the server actually recorded; legacy rows show
 * "Unknown actor".
 */
export function TaskActivityList({
  items,
  hasMore = false,
  limit = 8,
}: {
  items: TaskActivityItem[];
  hasMore?: boolean;
  limit?: number;
}) {
  return (
    <section className="mt-5 border-t border-[var(--ega-divider)] pt-4" aria-label="Activity">
      <h3 className="text-[length:var(--text-meta)] font-semibold uppercase tracking-[0.08em] text-[color:var(--ega-text-secondary)]">
        Activity
      </h3>
      {items.length === 0 ? (
        <p className="mt-2 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
          No activity recorded yet. Changes made from now on appear here.
        </p>
      ) : (
        <>
          <ol className="mt-2 flex flex-col gap-2">
            {items.map((item) => (
              <li key={item.id} className="text-[length:var(--text-meta)]">
                <p className="text-[color:var(--ega-text)]">{item.summary}</p>
                <p className="text-[color:var(--ega-text-tertiary)]">
                  {taskActivityActorLabel(item.actor)} ·{" "}
                  <time dateTime={item.occurredAt}>{formatActivityTime(item.occurredAt)}</time>
                </p>
              </li>
            ))}
          </ol>
          {hasMore ? (
            <p className="mt-2 text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
              Showing the latest {limit} changes.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
