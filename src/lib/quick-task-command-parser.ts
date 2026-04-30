import { getTodayLocalIsoDate, shiftDateOnlyValue } from "@/lib/task-due-date";
import type { TaskPriority } from "@/lib/task-domain";

export type QuickTaskCommandProject = {
  id: string;
  name: string;
};

export type QuickTaskCommandParseResult = {
  title: string;
  projectToken: string | null;
  projectId: string | null;
  projectName: string | null;
  projectError: string | null;
  dueDate: string | null;
  priority: TaskPriority | null;
  estimateMinutes: number | null;
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
  return value.replace(/^[,.;:]+|[,.;:]+$/g, "");
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

export function parseQuickTaskCommand(
  command: string,
  projects: QuickTaskCommandProject[],
  options?: { now?: Date },
): QuickTaskCommandParseResult {
  const now = options?.now ?? new Date();
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
  let dueDate: string | null = null;
  let priority: TaskPriority | null = null;
  let estimateMinutes: number | null = null;

  for (const rawToken of command.trim().split(/\s+/).filter(Boolean)) {
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

  return {
    title: titleTokens.join(" ").trim(),
    projectToken,
    projectId,
    projectName,
    projectError,
    dueDate,
    priority,
    estimateMinutes,
  };
}
