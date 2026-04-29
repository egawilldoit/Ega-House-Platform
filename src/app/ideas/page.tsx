import type { Metadata } from "next";
import { Inbox } from "lucide-react";

import { CreateIdeaNoteForm } from "@/app/ideas/create-idea-note-form";
import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  getIdeaInboxNotes,
  getIdeaNoteProjectOptions,
} from "@/lib/services/idea-note-service";
import { formatTaskToken } from "@/lib/task-domain";

export const metadata: Metadata = {
  title: "Ideas",
  description: "Capture loose ideas before they become tasks.",
};

function formatIdeaCreatedAt(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function IdeasPage() {
  const [notes, projectOptions] = await Promise.all([
    getIdeaInboxNotes(),
    getIdeaNoteProjectOptions(),
  ]);

  return (
    <AppShell
      eyebrow="Ideas Inbox"
      title="Ideas"
      description="Capture loose thoughts, opportunities, and follow-ups before deciding what they become."
    >
      <div className="grid gap-5 xl:grid-cols-[minmax(320px,420px)_1fr]">
        <Card className="border-[var(--border)] bg-white">
          <CardHeader>
            <CardTitle>Capture</CardTitle>
            <CardDescription>
              Add an inbox note without turning it into execution work yet.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateIdeaNoteForm projectOptions={projectOptions} />
          </CardContent>
        </Card>

        <Card className="border-[var(--border)] bg-white">
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Inbox</CardTitle>
              <CardDescription>
                Newest loose ideas waiting for later processing.
              </CardDescription>
            </div>
            <Badge tone="info">{notes.length} inbox</Badge>
          </CardHeader>
          <CardContent>
            {notes.length === 0 ? (
              <EmptyState
                icon={Inbox}
                title="No ideas captured yet"
                description="Capture a thought, improvement, or opportunity and keep it separate from tasks until you are ready to process it."
              />
            ) : (
              <div className="space-y-3">
                {notes.map((note) => (
                  <article
                    key={note.id}
                    className="ega-glass-soft rounded-[1.1rem] border border-[rgba(15,23,42,0.08)] p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="text-base font-semibold text-[color:var(--foreground)]">
                          {note.title}
                        </h2>
                        <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                          {formatIdeaCreatedAt(note.created_at)}
                        </p>
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        <Badge tone="info">{formatTaskToken(note.type)}</Badge>
                        <Badge tone="muted">Inbox</Badge>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      <Badge tone="muted">
                        {note.projects?.name ?? "No project"}
                      </Badge>
                      {note.priority ? (
                        <Badge tone="warn">{formatTaskToken(note.priority)}</Badge>
                      ) : null}
                      {note.tags.map((tag) => (
                        <Badge key={tag} tone="muted">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                    {note.body ? (
                      <p className="mt-3 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-[color:var(--muted-foreground)]">
                        {note.body}
                      </p>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
