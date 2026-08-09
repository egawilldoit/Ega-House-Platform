import { formatTaskEstimate } from "@/lib/task-estimate";
import { formatDurationLabel } from "@/lib/task-session";

export type WeeklyReviewTaskActivity = {
  id: string;
  title: string;
  status: string;
  blockedReason: string | null;
  estimateMinutes: number | null;
  completedAt: string | null;
  updatedAt: string;
  projectName: string | null;
  goalTitle: string | null;
  trackedSeconds: number;
};

export type WeeklyReviewTimeBucket = {
  id: string;
  label: string;
  trackedSeconds: number;
  sessionCount: number;
};

export type WeeklyReviewDraftInput = {
  weekStart: string;
  weekEnd: string;
  completedTasks: WeeklyReviewTaskActivity[];
  carriedTasks: WeeklyReviewTaskActivity[];
  blockedTasks: WeeklyReviewTaskActivity[];
  projectTime: WeeklyReviewTimeBucket[];
  taskTime: WeeklyReviewTimeBucket[];
  touchedProjects: string[];
  touchedGoals: string[];
  previousReview: {
    weekStart: string;
    weekEnd: string;
    summary: string | null;
    nextSteps: string | null;
  } | null;
};

export type WeeklyReviewDraft = {
  summary: string;
  wins: string;
  blockers: string;
  nextSteps: string;
};

const LIST_LIMIT = 8;

function formatCount(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function listOrFallback(items: string[], fallback: string) {
  if (items.length === 0) {
    return fallback;
  }

  return items.map((item) => `- ${item}`).join("\n");
}

function sortByTrackedThenTitle<T extends { trackedSeconds: number; title?: string; label?: string }>(
  rows: T[],
) {
  return [...rows].sort(
    (left, right) =>
      right.trackedSeconds - left.trackedSeconds ||
      (left.title ?? left.label ?? "").localeCompare(right.title ?? right.label ?? ""),
  );
}

function taskContext(task: WeeklyReviewTaskActivity) {
  return [task.projectName, task.goalTitle].filter(Boolean).join(" / ");
}

function taskEstimateVsActual(task: WeeklyReviewTaskActivity) {
  const estimate = formatTaskEstimate(task.estimateMinutes);
  const actual = task.trackedSeconds > 0 ? formatDurationLabel(task.trackedSeconds) : null;

  if (estimate && actual) {
    return `estimate ${estimate}, tracked ${actual}`;
  }

  if (estimate) {
    return `estimate ${estimate}`;
  }

  if (actual) {
    return `tracked ${actual}`;
  }

  return null;
}

function taskLine(task: WeeklyReviewTaskActivity) {
  const details = [taskContext(task), taskEstimateVsActual(task)].filter(Boolean);
  return `${task.title}${details.length > 0 ? ` (${details.join("; ")})` : ""}`;
}

function topTaskLines(tasks: WeeklyReviewTaskActivity[]) {
  return sortByTrackedThenTitle(tasks)
    .slice(0, LIST_LIMIT)
    .map(taskLine);
}

function topBlockedTaskLines(tasks: WeeklyReviewTaskActivity[]) {
  return sortByTrackedThenTitle(tasks)
    .slice(0, LIST_LIMIT)
    .map((task) => {
      const reason = task.blockedReason?.trim();
      return `${taskLine(task)}${reason ? ` - ${reason}` : " - Blocked with no reason recorded."}`;
    });
}

function topBucketLines(buckets: WeeklyReviewTimeBucket[], fallbackLabel: string) {
  return [...buckets]
    .sort(
      (left, right) =>
        right.trackedSeconds - left.trackedSeconds ||
        right.sessionCount - left.sessionCount ||
        left.label.localeCompare(right.label),
    )
    .slice(0, LIST_LIMIT)
    .map(
      (bucket) =>
        `${bucket.label}: ${formatDurationLabel(bucket.trackedSeconds)} across ${formatCount(
          bucket.sessionCount,
          "session",
        )}`,
    )
    .filter((line) => !line.startsWith(`${fallbackLabel}: 0s`));
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b),
  );
}

function previousContext(previousReview: WeeklyReviewDraftInput["previousReview"]) {
  if (!previousReview) {
    return "No previous weekly review was available for carry-forward context.";
  }

  const summary = previousReview.summary?.trim();
  const nextSteps = previousReview.nextSteps?.trim();

  if (!summary && !nextSteps) {
    return `Previous review (${previousReview.weekStart} to ${previousReview.weekEnd}) exists but has no usable summary or next steps.`;
  }

  return [
    `Previous review (${previousReview.weekStart} to ${previousReview.weekEnd}) context:`,
    summary ? `- Summary: ${summary}` : null,
    nextSteps ? `- Prior next steps: ${nextSteps}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function generateWeeklyReviewDraft(input: WeeklyReviewDraftInput): WeeklyReviewDraft {
  const completedTasks = topTaskLines(input.completedTasks);
  const carriedTasks = topTaskLines(input.carriedTasks);
  const blockedTasks = topBlockedTaskLines(input.blockedTasks);
  const projectTime = topBucketLines(input.projectTime, "Unassigned project");
  const taskTime = topBucketLines(input.taskTime, "Unassigned task");
  const touchedProjects = uniqueSorted(input.touchedProjects);
  const touchedGoals = uniqueSorted(input.touchedGoals);
  const totalTrackedSeconds = input.projectTime.reduce(
    (total, bucket) => total + bucket.trackedSeconds,
    0,
  );
  const hasActivity =
    input.completedTasks.length > 0 ||
    input.carriedTasks.length > 0 ||
    input.blockedTasks.length > 0 ||
    totalTrackedSeconds > 0 ||
    touchedProjects.length > 0 ||
    touchedGoals.length > 0;

  const summaryLines = hasActivity
    ? [
        `Week ${input.weekStart} to ${input.weekEnd}: ${formatCount(
          input.completedTasks.length,
          "task",
        )} completed, ${formatCount(input.carriedTasks.length, "task")} carried forward, ${formatCount(
          input.blockedTasks.length,
          "blocker",
        )} active, ${formatDurationLabel(totalTrackedSeconds)} tracked.`,
        touchedProjects.length > 0
          ? `Touched projects: ${touchedProjects.slice(0, LIST_LIMIT).join(", ")}.`
          : "No project updates were detected.",
        touchedGoals.length > 0
          ? `Touched goals: ${touchedGoals.slice(0, LIST_LIMIT).join(", ")}.`
          : "No goal updates were detected.",
        previousContext(input.previousReview),
      ]
    : [
        `Week ${input.weekStart} to ${input.weekEnd}: no completed tasks, blockers, carried tasks, or tracked time were found for this account.`,
        "Use this review to note offline work, planning decisions, or why execution data was sparse.",
        previousContext(input.previousReview),
      ];

  return {
    summary: [
      "Weekly Summary",
      summaryLines.join("\n"),
      "",
      "Time Breakdown",
      listOrFallback(projectTime, "- No tracked time by project this week."),
      "",
      "Tracked Tasks",
      listOrFallback(taskTime, "- No tracked task sessions this week."),
    ].join("\n"),
    wins: [
      "Wins",
      listOrFallback(
        completedTasks,
        "- No tasks were completed in app this week. Add manual wins here if progress happened elsewhere.",
      ),
      "",
      "Completed Tasks",
      listOrFallback(completedTasks, "- No completed tasks found for this weekly window."),
    ].join("\n"),
    blockers: [
      "Main Blockers",
      listOrFallback(blockedTasks, "- No active blocked tasks found for this week."),
    ].join("\n"),
    nextSteps: [
      "Carried-Over Tasks",
      listOrFallback(carriedTasks, "- No open carried-over tasks found for this week."),
      "",
      "Suggested Next Steps",
      listOrFallback(
        [
          ...input.blockedTasks.slice(0, 3).map((task) => `Unblock: ${taskLine(task)}`),
          ...input.carriedTasks.slice(0, 5).map((task) => `Continue: ${taskLine(task)}`),
        ],
        "- Pick one priority task for next week and schedule first work session.",
      ),
    ].join("\n"),
  };
}
