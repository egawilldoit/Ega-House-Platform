import type { Metadata } from "next";
import Link from "next/link";

import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Help",
  description: "Practical guidance for running the Project -> Goal -> Task -> Timer -> Review loop.",
};

const workflowSteps = [
  {
    title: "Plan on Goals",
    detail:
      "Use /goals to define outcome-based targets and the immediate next move for each objective.",
  },
  {
    title: "Break down in Tasks",
    detail:
      "Use /tasks to convert goal intent into concrete execution items with priority and due date clarity.",
  },
  {
    title: "Run focus sessions",
    detail:
      "Use /timer to start tracked sessions against active work so your execution data stays grounded in real time.",
  },
  {
    title: "Close the loop in Review",
    detail:
      "Use /review weekly to capture wins, blockers, and next steps based on what actually happened.",
  },
];

const faq = [
  {
    question: "Where should I start each day?",
    answer:
      "Open /dashboard first for the operational snapshot, then move into /tasks or /timer based on your priority queue.",
  },
  {
    question: "How do I connect tasks to strategy?",
    answer:
      "Attach tasks to goals whenever possible so weekly review reflects progress and blockers at the goal level.",
  },
  {
    question: "What if I do not use keyboard shortcuts heavily?",
    answer:
      "The workspace is fully usable with pointer and keyboard navigation. Keep actions route-focused and use the top bar search to move quickly.",
  },
];

export default async function HelpPage() {
  return (
    <AppShell
      eyebrow="Support"
      title="Help Center"
      description="Operational guidance for onboarding, navigation, and running the daily execution loop."
      actions={
        <Link
          href="/dashboard"
          className="btn-instrument btn-instrument-muted glass-label flex h-8 items-center gap-2 px-4"
        >
          Back to Dashboard
        </Link>
      }
    >
      <div className="space-y-6">
        <Card className="border-[var(--border)] bg-white">
          <CardHeader className="gap-2">
            <p className="glass-label text-signal-live">Getting Started</p>
            <CardTitle className="text-xl">Run the core workflow in five minutes</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 pt-0 md:grid-cols-2">
            <div className="rounded-[1rem] border border-[var(--border)] bg-[color:var(--instrument)] px-4 py-4">
              <p className="text-sm font-semibold text-[color:var(--foreground)]">1. Confirm your priorities</p>
              <p className="mt-2 text-sm leading-6 text-[color:var(--muted-foreground)]">
                Use <code>/dashboard</code> to check today&apos;s load, active projects, and timer state before starting work.
              </p>
            </div>
            <div className="rounded-[1rem] border border-[var(--border)] bg-[color:var(--instrument)] px-4 py-4">
              <p className="text-sm font-semibold text-[color:var(--foreground)]">2. Start from active tasks</p>
              <p className="mt-2 text-sm leading-6 text-[color:var(--muted-foreground)]">
                Open <code>/tasks</code> to refine the queue, then launch a timer session for the next item that should move today.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-[var(--border)] bg-white">
          <CardHeader className="gap-2">
            <p className="glass-label text-etch">Shortcuts</p>
            <CardTitle className="text-xl">Navigation and fast actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <div className="rounded-[1rem] border border-[var(--border)] bg-[color:var(--instrument)] px-4 py-3 text-sm text-[color:var(--muted-foreground)]">
              Use the left sidebar for direct route jumps between <code>/dashboard</code>, <code>/tasks</code>, <code>/goals</code>, <code>/timer</code>, and <code>/review</code>.
            </div>
            <div className="rounded-[1rem] border border-[var(--border)] bg-[color:var(--instrument)] px-4 py-3 text-sm text-[color:var(--muted-foreground)]">
              Use the top search field to find tasks, goals, and projects quickly without leaving your current context.
            </div>
          </CardContent>
        </Card>

        <Card className="border-[var(--border)] bg-white">
          <CardHeader className="gap-2">
            <p className="glass-label text-etch">Workflow Guides</p>
            <CardTitle className="text-xl">{"Project -> Goal -> Task -> Timer -> Review"}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 pt-0 lg:grid-cols-2">
            {workflowSteps.map((step) => (
              <article
                key={step.title}
                className="rounded-[1rem] border border-[var(--border)] bg-[color:var(--instrument)] px-4 py-4"
              >
                <p className="text-sm font-semibold text-[color:var(--foreground)]">{step.title}</p>
                <p className="mt-2 text-sm leading-6 text-[color:var(--muted-foreground)]">{step.detail}</p>
              </article>
            ))}
          </CardContent>
        </Card>

        <Card className="border-[var(--border)] bg-white">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <p className="glass-label text-etch">FAQ</p>
              <CardTitle className="mt-2 text-xl">Common operating questions</CardTitle>
            </div>
            <Badge tone="muted">Practical v1</Badge>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {faq.map((item) => (
              <article
                key={item.question}
                className="rounded-[1rem] border border-[var(--border)] bg-[color:var(--instrument)] px-4 py-4"
              >
                <h2 className="text-sm font-semibold text-[color:var(--foreground)]">{item.question}</h2>
                <p className="mt-2 text-sm leading-6 text-[color:var(--muted-foreground)]">{item.answer}</p>
              </article>
            ))}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
