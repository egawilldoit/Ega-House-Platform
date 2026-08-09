import { getTodayLocalIsoDate, shiftDateOnlyValue } from "@/lib/task-due-date";
import type { TaskPriority } from "@/lib/task-domain";

export type QuickTaskCommandProject = {
  id: string;
  name: string;
};

export type QuickTaskCommandGoal = {
  id: string;
  title: string;
  project_id: string;
};

export type QuickTaskCommandParseResult = {
  title: string;
  projectToken: string | null;
  projectId: string | null;
  projectName: string | null;
  projectError: string | null;
  goalToken: string | null;
  goalId: string | null;
  goalName: string | null;
  goalError: string | null;
  dueDate: string | null;
  priority: TaskPriority | null;
  estimateMinutes: number | null;
  status: "todo" | "blocked" | null;
  blockedReason: string | null;
  blockedError: string | null;
};

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

const PRIORITY_ALIASES: Record<string, TaskPriority> = {
  urgent: "urgent",
  high: "high",
  medium: "medium",
  low: "low",
  "!urgent": "urgent",
  "!high": "high",
  "!medium": "medium",
  "!low": "low",
  "p1": "urgent",
  "p2": "high",
  "p3": "medium",
  "p4": "low",
  "prio:urgent": "urgent",
  "prio:high": "high",
  "prio:medium": "medium",
  "prio:low": "low",
  "priority:urgent": "urgent",
  "priority:high": "high",
  "priority:medium": "medium",
  "priority:low": "low",
};

function normalizeProjectLookup(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function stripBoundaryPunctuation(value: string) {
  return value.replace(/^[,.;]+|[,.;]+$/g, "");
}

function parseDueToken(token: string, now: Date) {
  if (token === "today") {
    return getTodayLocalIsoDate(now);
  }

  if (token === "tomorrow") {
    return shiftDateOnlyValue(getTodayLocalIsoDate(now), 1);
  }

  const weekday = WEEKDAY_INDEX[token];
  if (weekday === undefined) {
    return null;
  }

  const currentDay = now.getDay();
  const daysUntil = (weekday - currentDay + 7) % 7 || 7;
  return shiftDateOnlyValue(getTodayLocalIsoDate(now), daysUntil);
}

function parseEstimateToken(token: string) {
  const prefixed = token.match(/^(?:est|estimate):(.+)$/);
  const value = prefixed?.[1] ?? token;
  if (prefixed && /^\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }

  const compactHours = value.match(/^(\d+)h(?:(\d+)m)?$/);
  if (compactHours) {
    return Number.parseInt(compactHours[1] ?? "0", 10) * 60
      + Number.parseInt(compactHours[2] ?? "0", 10);
  }

  const compactMinutes = value.match(/^(\d+)(?:m|min|mins)$/);
  if (compactMinutes) {
    return Number.parseInt(compactMinutes[1] ?? "0", 10);
  }

  return null;
}

function tokenizeCommand(command: string) {
  return command.match(/"[^"]*"|\S+/g) ?? [];
}

function stripWrappingQuotes(value: string) {
  return value.replace(/^"|"$/g, "");
}

function isGoalBoundaryToken(token: string, now: Date) {
  const normalizedToken = stripBoundaryPunctuation(token).toLowerCase();

  return (
    normalizedToken.startsWith("#")
    || normalizedToken.startsWith("/")
    || normalizedToken.startsWith("@blocked:")
    || normalizedToken.startsWith("goal:")
    || Boolean(parseDueToken(normalizedToken, now))
    || Boolean(PRIORITY_ALIASES[normalizedToken])
    || parseEstimateToken(normalizedToken) !== null
  );
}

export function parseQuickTaskCommand(
  command: string,
  projects: QuickTaskCommandProject[],
  goalsOrOptions?: QuickTaskCommandGoal[] | { now?: Date; selectedProjectId?: string | null },
  options?: { now?: Date; selectedProjectId?: string | null },
): QuickTaskCommandParseResult {
  const goals = Array.isArray(goalsOrOptions) ? goalsOrOptions : [];
  const parserOptions = Array.isArray(goalsOrOptions) ? options : goalsOrOptions;
  const now = parserOptions?.now ?? new Date();
  const projectLookup = new Map(
    projects.flatMap((project) => [
      [normalizeProjectLookup(project.name), project],
      [normalizeProjectLookup(project.id), project],
    ]),
  );
  const titleTokens: string[] = [];
  let projectToken: string | null = null;
  let projectId: string | null = null;
  let projectName: string | null = null;
  let projectError: string | null = null;
  let goalToken: string | null = null;
  let goalId: string | null = null;
  let goalName: string | null = null;
  let goalError: string | null = null;
  let dueDate: string | null = null;
  let priority: TaskPriority | null = null;
  let estimateMinutes: number | null = null;
  let status: "todo" | "blocked" | null = null;
  let blockedReason: string | null = null;
  let blockedError: string | null = null;

  const tokens = tokenizeCommand(command.trim());
  for (let index = 0; index < tokens.length; index += 1) {
    const rawToken = tokens[index] ?? "";
    const token = stripBoundaryPunctuation(rawToken);
    const normalizedToken = token.toLowerCase();

    if (token.startsWith("#") && token.length > 1) {
      projectToken = token.slice(1);
      const project = projectLookup.get(normalizeProjectLookup(projectToken));
      if (project) {
        projectId = project.id;
        projectName = project.name;
        projectError = null;
      } else {
        projectId = null;
        projectName = null;
        projectError = `Project "${projectToken}" is unavailable.`;
      }
      continue;
    }

    if (token.startsWith("/") && token.length > 1) {
      goalToken = stripWrappingQuotes(token.slice(1));
      continue;
    }

    if (normalizedToken.startsWith("goal:")) {
      const goalParts = [stripWrappingQuotes(token.slice("goal:".length))]
        .filter(Boolean);

      while (index + 1 < tokens.length && !isGoalBoundaryToken(tokens[index + 1] ?? "", now)) {
        index += 1;
        goalParts.push(stripWrappingQuotes(stripBoundaryPunctuation(tokens[index] ?? "")));
      }

      goalToken = goalParts.join(" ").trim();
      continue;
    }

    if (normalizedToken.startsWith("@blocked:")) {
      status = "blocked";
      const reason = stripWrappingQuotes(token.slice("@blocked:".length)).trim();
      blockedReason = reason || null;
      blockedError = blockedReason
        ? null
        : "Blocked reason is required when status is Blocked.";
      continue;
    }

    const parsedDueDate = parseDueToken(normalizedToken, now);
    if (parsedDueDate) {
      dueDate = parsedDueDate;
      continue;
    }

    const parsedPriority = PRIORITY_ALIASES[normalizedToken];
    if (parsedPriority) {
      priority = parsedPriority;
      continue;
    }

    const parsedEstimate = parseEstimateToken(normalizedToken);
    if (parsedEstimate !== null) {
      estimateMinutes = parsedEstimate;
      continue;
    }

    titleTokens.push(rawToken);
  }

  if (goalToken !== null) {
    const effectiveProjectId = projectId ?? parserOptions?.selectedProjectId ?? null;
    const goal = goals.find(
      (candidate) =>
        candidate.project_id === effectiveProjectId
        && normalizeProjectLookup(candidate.title) === normalizeProjectLookup(goalToken ?? ""),
    );

    if (goal) {
      goalId = goal.id;
      goalName = goal.title;
      goalError = null;
    } else {
      goalId = null;
      goalName = null;
      goalError = `Goal "${goalToken}" is unavailable for the selected project.`;
    }
  }

  return {
    title: titleTokens.join(" ").trim(),
    projectToken,
    projectId,
    projectName,
    projectError,
    goalToken,
    goalId,
    goalName,
    goalError,
    dueDate,
    priority,
    estimateMinutes,
    status,
    blockedReason,
    blockedError,
  };
}
