import Link from "next/link";
import { AlertTriangle, Clock, Flag, Folder, Timer } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SectionHeader } from "@/components/ui/section-header";

type AttentionItem = {
  id: string;
  label: string;
  detail: string;
  href: string;
  tone: "overdue" | "risk" | "blocked" | "pending";
  icon: typeof AlertTriangle;
};

function toneClasses(tone: AttentionItem["tone"]) {
  switch (tone) {
    case "overdue":
      return "border-[var(--status-overdue-border)] bg-[var(--status-overdue-bg)] text-[var(--status-overdue)]";
    case "risk":
      return "border-[var(--status-risk-border)] bg-[var(--status-risk-bg)] text-[var(--status-risk)]";
    case "blocked":
      return "border-[var(--status-overdue-border)] bg-[var(--status-overdue-bg)] text-[var(--status-overdue)]";
    case "pending":
      return "border-[var(--ega-border)] bg-[var(--ega-surface-subtle)] text-[var(--ega-text-secondary)]";
    default:
      return "border-[var(--ega-border)] bg-[var(--ega-surface-subtle)] text-[var(--ega-text-secondary)]";
  }
}

export function AttentionQueueCard({ items }: { items: AttentionItem[] }) {
  const sorted = [...items].sort((a, b) => {
    const order = { overdue: 0, blocked: 1, risk: 2, pending: 3 } as const;
    return (order[a.tone] ?? 9) - (order[b.tone] ?? 9);
  });

  return (
    <Card className="h-full border-[var(--ega-border)] bg-[var(--ega-surface)] shadow-[var(--ega-shadow-sm)]">
      <CardHeader className="pb-3">
        <SectionHeader
          eyebrow="Attention"
          title="Queue"
          description="One authority for urgent cross-domain items."
        />
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        {sorted.length === 0 ? (
          <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--ega-border)] bg-[var(--ega-surface-subtle)] p-4 text-center">
            <p className="text-sm font-medium text-[var(--ega-text)]">All clear</p>
            <p className="mt-1 text-xs leading-5 text-[var(--ega-text-secondary)]">No overdue or blocked work detected.</p>
          </div>
        ) : (
          sorted.slice(0, 6).map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.id}
                href={item.href}
                className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--ega-border)] bg-[var(--ega-surface)] p-3 transition-colors hover:bg-[var(--ega-surface-hover)] hover:border-[var(--ega-border-strong)]"
              >
                <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${toneClasses(item.tone)}`}>
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium leading-5 text-[var(--ega-text)]">{item.label}</span>
                  <span className="block truncate text-xs leading-4 text-[var(--ega-text-secondary)]">{item.detail}</span>
                </span>
                <Badge tone={item.tone === "overdue" || item.tone === "blocked" ? "error" : item.tone === "risk" ? "warn" : "muted"} className="shrink-0 capitalize">
                  {item.tone}
                </Badge>
              </Link>
            );
          })
        )}
        {sorted.length > 6 ? <p className="pt-1 text-center text-xs text-[var(--ega-text-tertiary)]">+{sorted.length - 6} more</p> : null}
      </CardContent>
    </Card>
  );
}

export function buildAttentionItems(input: {
  blockedCount: number;
  overdueCount: number;
  dueTodayCount: number;
  reviewMissing: boolean;
  atRiskGoals: Array<{ id: string; title: string }>;
  dueProjects: Array<{ id: string; name: string; slug: string }>;
}): AttentionItem[] {
  const items: AttentionItem[] = [];

  if (input.overdueCount > 0) {
    items.push({
      id: "overdue-tasks",
      label: `${input.overdueCount} overdue task${input.overdueCount === 1 ? "" : "s"}`,
      detail: "Due date passed · needs reschedule",
      href: "/tasks?due=overdue",
      tone: "overdue",
      icon: Clock,
    });
  }

  if (input.blockedCount > 0) {
    items.push({
      id: "blocked-tasks",
      label: `${input.blockedCount} blocked`,
      detail: "Unblocked to move forward",
      href: "/tasks?status=blocked",
      tone: "blocked",
      icon: AlertTriangle,
    });
  }

  for (const goal of input.atRiskGoals.slice(0, 2)) {
    items.push({
      id: `goal-${goal.id}`,
      label: goal.title,
      detail: "Goal · at risk",
      href: "/goals",
      tone: "risk",
      icon: Flag,
    });
  }

  for (const project of input.dueProjects.slice(0, 2)) {
    items.push({
      id: `project-${project.id}`,
      label: project.name,
      detail: "Project · due soon",
      href: project.slug ? `/tasks/projects/${project.slug}` : "/tasks/projects",
      tone: "pending",
      icon: Folder,
    });
  }

  if (input.reviewMissing) {
    items.push({
      id: "review-missing",
      label: "Weekly review due",
      detail: "Close the loop · review pending",
      href: "/review",
      tone: "pending",
      icon: Timer,
    });
  }

  if (input.dueTodayCount > 0 && items.length < 6) {
    items.push({
      id: "due-today",
      label: `${input.dueTodayCount} due today`,
      detail: "Plan in Today",
      href: "/today",
      tone: "pending",
      icon: Clock,
    });
  }

  return items;
}
