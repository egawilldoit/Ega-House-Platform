import {
  addDaysToIsoDate,
  isIsoDate,
  isTaskPriority,
  type GoalStatus,
  type TaskPriority,
} from "@ega/domain";

import { applicationFailure, applicationSuccess, type ApplicationResult } from "../shared/result";

/**
 * Project templates are typed application-layer definitions, not a table.
 *
 * The owner of the definition is this module; persistence stays in the
 * existing project/goal/task tables through `createProjectFromTemplate` in
 * `./service.ts`. A template only ever contributes titles, descriptions,
 * priorities, estimates and whole-day due offsets — never ids, credentials,
 * timer evidence or references to other owners' rows.
 *
 * Every relative due date is a whole-day offset from the owner's local date
 * (see `resolveProjectTemplatePreview`). Keeping the definition date-only is
 * what makes DST and end-of-month behaviour deterministic: the local date comes
 * from the canonical Time Context owner and the arithmetic is calendar-only.
 */

export const PROJECT_TEMPLATE_IDS = [
  "blank",
  "job-application-sprint",
  "feature-release",
  "weekly-review",
] as const;

export type ProjectTemplateId = (typeof PROJECT_TEMPLATE_IDS)[number];

export type ProjectTemplateTaskDefinition = Readonly<{
  title: string;
  description?: string;
  priority: TaskPriority;
  estimateMinutes?: number;
  /** Whole days after the owner's local date. 0 means today. */
  dueOffsetDays: number;
}>;

export type ProjectTemplateGoalDefinition = Readonly<{
  title: string;
  description?: string;
  tasks: readonly ProjectTemplateTaskDefinition[];
}>;

export type ProjectTemplateDefinition = Readonly<{
  id: ProjectTemplateId;
  name: string;
  summary: string;
  projectDescription: string;
  goals: readonly ProjectTemplateGoalDefinition[];
}>;

const BLANK_TEMPLATE: ProjectTemplateDefinition = {
  id: "blank",
  name: "Blank",
  summary: "Start empty and add goals and tasks as you go.",
  projectDescription: "",
  goals: [],
};

const JOB_APPLICATION_SPRINT: ProjectTemplateDefinition = {
  id: "job-application-sprint",
  name: "Job application sprint",
  summary: "A two-week push from target roles to follow-ups.",
  projectDescription:
    "Run a focused two-week job search: define targets, sharpen the application, send, and follow up.",
  goals: [
    {
      title: "Application pipeline",
      description: "Get applications out the door with a repeatable process.",
      tasks: [
        {
          title: "List target roles and companies",
          description: "Pick the roles worth applying to and the reason for each.",
          priority: "high",
          estimateMinutes: 45,
          dueOffsetDays: 1,
        },
        {
          title: "Update CV for the target roles",
          description: "Rewrite the summary and the two most relevant bullets.",
          priority: "high",
          estimateMinutes: 90,
          dueOffsetDays: 3,
        },
        {
          title: "Tailor and send the first application",
          description: "Adapt the cover note and submit one application end to end.",
          priority: "urgent",
          estimateMinutes: 60,
          dueOffsetDays: 5,
        },
        {
          title: "Send four more applications",
          description: "Reuse the tailored version, adjust per role.",
          priority: "high",
          estimateMinutes: 180,
          dueOffsetDays: 8,
        },
        {
          title: "Follow up on sent applications",
          description: "One short follow-up per application that is a week old.",
          priority: "medium",
          estimateMinutes: 30,
          dueOffsetDays: 12,
        },
      ],
    },
    {
      title: "Interview readiness",
      description: "Be ready before the first reply arrives.",
      tasks: [
        {
          title: "Write down six project stories",
          description: "Situation, action, and measurable result for each.",
          priority: "medium",
          estimateMinutes: 60,
          dueOffsetDays: 9,
        },
        {
          title: "Run one mock interview",
          description: "Talk the stories out loud and note where they drag.",
          priority: "medium",
          estimateMinutes: 45,
          dueOffsetDays: 13,
        },
      ],
    },
  ],
};

const FEATURE_RELEASE: ProjectTemplateDefinition = {
  id: "feature-release",
  name: "Feature release",
  summary: "Scope, build, verify, and ship one feature.",
  projectDescription:
    "Take one feature from problem statement to a merged, verified release.",
  goals: [
    {
      title: "Scope",
      description: "Agree on the problem and the finish line before writing code.",
      tasks: [
        {
          title: "Write the problem statement and acceptance criteria",
          description: "What changes for the user, and how will we know it works?",
          priority: "high",
          estimateMinutes: 45,
          dueOffsetDays: 1,
        },
        {
          title: "Break the feature into reviewable tasks",
          description: "Each task should be independently verifiable.",
          priority: "medium",
          estimateMinutes: 30,
          dueOffsetDays: 2,
        },
      ],
    },
    {
      title: "Build",
      description: "Implement the smallest coherent path at the canonical owner.",
      tasks: [
        {
          title: "Implement the thin path end to end",
          description: "One working slice through every affected layer.",
          priority: "high",
          estimateMinutes: 240,
          dueOffsetDays: 5,
        },
        {
          title: "Add focused regression tests",
          description: "Cover the boundary that actually changed.",
          priority: "high",
          estimateMinutes: 120,
          dueOffsetDays: 6,
        },
      ],
    },
    {
      title: "Ship",
      description: "Verify, merge, and write down what shipped.",
      tasks: [
        {
          title: "Run the verification gates",
          description: "Typecheck, lint, affected tests, and the production build.",
          priority: "high",
          estimateMinutes: 60,
          dueOffsetDays: 9,
        },
        {
          title: "Open the PR and address review",
          description: "Describe the change, the proof, and the remaining risk.",
          priority: "medium",
          estimateMinutes: 45,
          dueOffsetDays: 11,
        },
        {
          title: "Publish release notes",
          description: "What changed, who it is for, and how to undo it.",
          priority: "low",
          estimateMinutes: 20,
          dueOffsetDays: 13,
        },
      ],
    },
  ],
};

const WEEKLY_REVIEW: ProjectTemplateDefinition = {
  id: "weekly-review",
  name: "Weekly review",
  summary: "Close the week and set the next one up.",
  projectDescription:
    "A repeating weekly review project: capture what happened, clear the decks, and choose next week's focus.",
  goals: [
    {
      title: "Close the week",
      description: "Turn the finished week into a decision for the next one.",
      tasks: [
        {
          title: "Collect wins, blockers, and loose ends",
          description: "Write one line per item; no filtering yet.",
          priority: "medium",
          estimateMinutes: 20,
          dueOffsetDays: 1,
        },
        {
          title: "Clear the inbox and close stale tasks",
          description: "Move, schedule, or archive everything that stalled.",
          priority: "medium",
          estimateMinutes: 30,
          dueOffsetDays: 2,
        },
        {
          title: "Choose next week's three priorities",
          description: "Only three, and each with a first physical action.",
          priority: "high",
          estimateMinutes: 25,
          dueOffsetDays: 3,
        },
        {
          title: "Write the review summary",
          description: "Two paragraphs: what moved, what changes next week.",
          priority: "low",
          estimateMinutes: 20,
          dueOffsetDays: 3,
        },
      ],
    },
  ],
};

export const PROJECT_TEMPLATES: readonly ProjectTemplateDefinition[] = [
  BLANK_TEMPLATE,
  JOB_APPLICATION_SPRINT,
  FEATURE_RELEASE,
  WEEKLY_REVIEW,
];

export function isProjectTemplateId(value: string): value is ProjectTemplateId {
  return (PROJECT_TEMPLATE_IDS as readonly string[]).includes(value);
}

export function getProjectTemplate(
  templateId: ProjectTemplateId,
): ProjectTemplateDefinition {
  const found = PROJECT_TEMPLATES.find((candidate) => candidate.id === templateId);
  // The id union is exhaustive; this guard keeps a future id addition honest.
  if (!found) throw new Error(`Unknown project template: ${templateId}`);
  return found;
}

export type ProjectTemplatePreviewTask = Readonly<{
  title: string;
  description: string | null;
  priority: TaskPriority;
  estimateMinutes: number | null;
  dueOffsetDays: number;
  /** Resolved owner-local calendar date (YYYY-MM-DD). */
  dueDate: string;
}>;

export type ProjectTemplatePreviewGoal = Readonly<{
  title: string;
  description: string | null;
  tasks: readonly ProjectTemplatePreviewTask[];
}>;

export type ProjectTemplatePreview = Readonly<{
  templateId: ProjectTemplateId;
  name: string;
  summary: string;
  projectDescription: string;
  goalCount: number;
  taskCount: number;
  goals: readonly ProjectTemplatePreviewGoal[];
}>;

function invalidTemplateDefinition(message: string) {
  return applicationFailure<ProjectTemplatePreview>(`Template definition is invalid: ${message}`, "unknown");
}

/**
 * Resolve a template against the owner's local date.
 *
 * This is the single resolver used by both the preview and the create call, so
 * "preview exactly what will be created" is structural rather than a promise:
 * the same function produces the dates that are persisted.
 */
export function resolveProjectTemplatePreview(input: {
  templateId: unknown;
  localDate: unknown;
}): ApplicationResult<ProjectTemplatePreview> {
  const templateId = String(input.templateId ?? "").trim();
  const localDate = String(input.localDate ?? "").trim();

  if (!isProjectTemplateId(templateId)) {
    return applicationFailure("Choose a project template.", "validation");
  }

  if (!isIsoDate(localDate)) {
    return applicationFailure("Unable to resolve the owner's local date.", "unknown");
  }

  const definition = getProjectTemplate(templateId);
  const goals: ProjectTemplatePreviewGoal[] = [];

  for (const goal of definition.goals) {
    const goalTitle = goal.title.trim();
    if (!goalTitle) return invalidTemplateDefinition("goal title is empty.");

    const resolvedTasks: ProjectTemplatePreviewTask[] = [];

    for (const task of goal.tasks) {
      const title = task.title.trim();
      if (!title) return invalidTemplateDefinition("task title is empty.");
      if (!isTaskPriority(task.priority)) return invalidTemplateDefinition(`task priority "${task.priority}" is invalid.`);
      if (!Number.isInteger(task.dueOffsetDays) || task.dueOffsetDays < 0 || task.dueOffsetDays > 90) {
        return invalidTemplateDefinition("task due offset must be between 0 and 90 days.");
      }
      if (
        task.estimateMinutes !== undefined
        && (!Number.isInteger(task.estimateMinutes) || task.estimateMinutes < 1 || task.estimateMinutes > 1440)
      ) {
        return invalidTemplateDefinition("task estimate must be between 1 and 1440 minutes.");
      }

      resolvedTasks.push({
        title,
        description: task.description?.trim() || null,
        priority: task.priority,
        estimateMinutes: task.estimateMinutes ?? null,
        dueOffsetDays: task.dueOffsetDays,
        dueDate: addDaysToIsoDate(localDate, task.dueOffsetDays),
      });
    }

    goals.push({
      title: goalTitle,
      description: goal.description?.trim() || null,
      tasks: resolvedTasks,
    });
  }

  return applicationSuccess({
    templateId,
    name: definition.name,
    summary: definition.summary,
    projectDescription: definition.projectDescription,
    goalCount: goals.length,
    taskCount: goals.reduce((total, goal) => total + goal.tasks.length, 0),
    goals,
  });
}

/**
 * Goal status for template-created goals. The owner picked a template to start
 * the work now, so goals are active rather than the blank-create draft default.
 * The declared `GoalStatus` type keeps this inside the canonical status list.
 */
export const PROJECT_TEMPLATE_GOAL_STATUS: GoalStatus = "active";
