import { getTaskDueDateState, getTodayLocalIsoDate } from "@/lib/task-due-date";
import { isTaskCompletedStatus } from "@/lib/task-domain";

type FocusPriority = "low" | "medium" | "high" | "urgent";

export type FocusPanelTask = {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  focusRank: number | null;
  updatedAt: string;
  estimateMinutes: number | null;
  projectName: string;
  projectSlug: string | null;
  goalTitle: string | null;
};

export type FocusPanelRecommendation = {
  task: FocusPanelTask;
  signals: string[];
  openTaskCount: number;
  blockedTaskCount: number;
  pinnedTaskCount: number;
};

export type FocusPanelCandidateState =
  | { state: "recommended"; recommendation: FocusPanelRecommendation }
  | {
      state: "blocked_only";
      blockedTaskCount: number;
      openTaskCount: number;
      pinnedTaskCount: number;
    }
  | { state: "empty" };

const BLOCKED_STATUSES = new Set(["blocked"]);

function normalizeToken(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function isCompletedStatus(status: string | null | undefined) {
  return isTaskCompletedStatus(status);
}

function isBlockedStatus(status: string | null | undefined) {
  return BLOCKED_STATUSES.has(normalizeToken(status));
}

function scorePriority(priority: FocusPriority | string) {
  switch (normalizeToken(priority) as FocusPriority) {
    case "urgent":
      return 220;
    case "high":
      return 140;
    case "medium":
      return 60;
    default:
      return 20;
  }
}

function scoreRecency(updatedAt: string, nowIso: string) {
  const updatedMs = Date.parse(updatedAt);
  const nowMs = Date.parse(nowIso);

  if (!Number.isFinite(updatedMs) || !Number.isFinite(nowMs)) {
    return 0;
  }

  const ageHours = (nowMs - updatedMs) / (1000 * 60 * 60);

  if (ageHours <= 24) {
    return 80;
  }

  if (ageHours <= 72) {
    return 40;
  }

  return 0;
}

function scoreDueDate(task: FocusPanelTask, todayIsoDate: string) {
  const dueState = getTaskDueDateState(task.dueDate, task.status, todayIsoDate);

  switch (dueState) {
    case "overdue":
      return 500;
    case "today":
      return 420;
    case "soon":
      return 300;
    default:
      return 0;
  }
}

function scoreTask(task: FocusPanelTask, nowIso: string, todayIsoDate: string) {
  let score = 0;

  if (typeof task.focusRank === "number" && Number.isFinite(task.focusRank)) {
    score += 1000 - task.focusRank * 8;
  }

  if (normalizeToken(task.status) === "in_progress") {
    score += 260;
  }

  score += scoreDueDate(task, todayIsoDate);
  score += scorePriority(task.priority);
  score += scoreRecency(task.updatedAt, nowIso);

  return score;
}

function sortCandidateTasks(tasks: FocusPanelTask[], nowIso: string, todayIsoDate: string) {
  return tasks.slice().sort((left, right) => {
    const scoreDelta = scoreTask(right, nowIso, todayIsoDate) - scoreTask(left, nowIso, todayIsoDate);

    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    const leftIsPinned = typeof left.focusRank === "number";
    const rightIsPinned = typeof right.focusRank === "number";

    if (leftIsPinned && rightIsPinned) {
      const rankDelta = (left.focusRank ?? 0) - (right.focusRank ?? 0);
      if (rankDelta !== 0) {
        return rankDelta;
      }
    }

    if (left.dueDate && right.dueDate && left.dueDate !== right.dueDate) {
      return left.dueDate.localeCompare(right.dueDate);
    }

    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  });
}

function getRecommendationSignals(task: FocusPanelTask, nowIso: string, todayIsoDate: string) {
  const signals: string[] = [];

  if (typeof task.focusRank === "number" && Number.isFinite(task.focusRank)) {
    signals.push(`Pinned #${task.focusRank}`);
  }

  const dueState = getTaskDueDateState(task.dueDate, task.status, todayIsoDate);
  if (dueState === "overdue") {
    signals.push("Overdue");
  } else if (dueState === "today") {
    signals.push("Due today");
  } else if (dueState === "soon") {
    signals.push("Due soon");
  }

  if (normalizeToken(task.status) === "in_progress") {
    signals.push("In progress");
  }

  const priority = normalizeToken(task.priority);
  if (priority === "urgent") {
    signals.push("Urgent");
  } else if (priority === "high") {
    signals.push("High priority");
  }

  if (scoreRecency(task.updatedAt, nowIso) >= 40) {
    signals.push("Recently touched");
  }

  return signals;
}

export function getFocusPanelCandidateState(
  tasks: FocusPanelTask[],
  nowIso = new Date().toISOString(),
): FocusPanelCandidateState {
  const openTasks = tasks.filter((task) => !isCompletedStatus(task.status));

  if (openTasks.length === 0) {
    return { state: "empty" };
  }

  const blockedTasks = openTasks.filter((task) => isBlockedStatus(task.status));
  const actionableTasks = openTasks.filter((task) => !isBlockedStatus(task.status));
  const pinnedTaskCount = openTasks.filter(
    (task) => typeof task.focusRank === "number" && Number.isFinite(task.focusRank),
  ).length;

  if (actionableTasks.length === 0) {
    return {
      state: "blocked_only",
      blockedTaskCount: blockedTasks.length,
      openTaskCount: openTasks.length,
      pinnedTaskCount,
    };
  }

  const todayIsoDate = getTodayLocalIsoDate(new Date(nowIso));
  const sortedCandidates = sortCandidateTasks(actionableTasks, nowIso, todayIsoDate);
  const recommendedTask = sortedCandidates[0];

  return {
    state: "recommended",
    recommendation: {
      task: recommendedTask,
      signals: getRecommendationSignals(recommendedTask, nowIso, todayIsoDate),
      openTaskCount: openTasks.length,
      blockedTaskCount: blockedTasks.length,
      pinnedTaskCount,
    },
  };
}
