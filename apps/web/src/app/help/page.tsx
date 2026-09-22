import type { Metadata } from "next";
import Link from "next/link";

import { AppShell } from "@/components/layout/app-shell";
import { SHORTCUT_HELP_SECTIONS } from "@/lib/keyboard-shortcuts";

import { HelpDirectory, type HelpGroup } from "./help-directory";

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

const shortcutEntries = SHORTCUT_HELP_SECTIONS.flatMap((section) =>
  section.shortcuts.map((shortcut) => ({
    id: `shortcut-${shortcut.id}`,
    title: shortcut.description,
    detail: `${section.title} shortcut`,
    combo: shortcut.combo,
  })),
);

const helpGroups: HelpGroup[] = [
  {
    id: "getting-started",
    title: "Getting Started",
    description: "Run the core workflow in five minutes.",
    entries: [
      {
        id: "getting-started-priorities",
        title: "1. Confirm your priorities",
        detail:
          "Use /dashboard to check today's load, active projects, and timer state before starting work.",
      },
      {
        id: "getting-started-tasks",
        title: "2. Start from active tasks",
        detail:
          "Open /tasks to refine the queue, then launch a timer session for the next item that should move today.",
      },
    ],
  },
  {
    id: "shortcuts",
    title: "Shortcuts",
    description: "Navigation and fast actions, including the keyboard shortcut sheet (press ?).",
    entries: [
      {
        id: "shortcuts-sidebar",
        title: "Route jumps",
        detail:
          "Use the left sidebar for direct route jumps between /dashboard, /tasks, /goals, /timer, and /review.",
      },
      {
        id: "shortcuts-search",
        title: "Search",
        detail:
          "Use the top search field to find tasks, goals, and projects quickly without leaving your current context.",
      },
      ...shortcutEntries,
    ],
  },
  {
    id: "workflow-guides",
    title: "Workflow Guides",
    description: "Project -> Goal -> Task -> Timer -> Review.",
    entries: workflowSteps.map((step, index) => ({
      id: `workflow-${index}`,
      title: step.title,
      detail: step.detail,
    })),
  },
  {
    id: "faq",
    title: "FAQ",
    description: "Common operating questions.",
    entries: faq.map((item, index) => ({
      id: `faq-${index}`,
      title: item.question,
      detail: item.answer,
    })),
  },
];

export default async function HelpPage() {
  return (
    <AppShell
      title="Help Center"
      description="Workflow guide — Projects → Goals → Tasks → Timer → Review."
      actions={
        <Link
          href="/dashboard"
          className="btn-instrument btn-instrument-muted flex h-8 items-center gap-2 px-3 text-sm"
        >
          Back to Dashboard
        </Link>
      }
    >
      <HelpDirectory groups={helpGroups} />
    </AppShell>
  );
}
