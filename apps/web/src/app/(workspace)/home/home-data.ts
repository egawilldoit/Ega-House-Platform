export const LOGIN_HREF = "/login?next=%2Fdashboard";
export const SIGNUP_HREF = "/signup";

export type LoopStep = {
  title: string;
  description: string;
};

export const LOOP_STEPS: readonly LoopStep[] = [
  {
    title: "Goals",
    description: "Objectives, milestones, and next actions in one visible hierarchy.",
  },
  {
    title: "Planning",
    description: "Work linked to its goal, with load, priority, and timing explicit.",
  },
  {
    title: "Focus",
    description: "Timed sessions against a task, so effort becomes evidence.",
  },
  {
    title: "Review",
    description: "What moved, what stalled, and what to correct next week.",
  },
] as const;

export type BoardTask = {
  label: string;
  kind: "Objective" | "Milestone" | "Next";
  done: boolean;
};

export const BOARD_TASKS: readonly BoardTask[] = [
  {
    label: "Draft the new home hero",
    kind: "Objective",
    done: true,
  },
  {
    label: "Fix the login layout",
    kind: "Objective",
    done: false,
  },
  {
    label: "Log a focus session on the milestone",
    kind: "Milestone",
    done: false,
  },
  {
    label: "Close the homepage delivery slice",
    kind: "Next",
    done: false,
  },
] as const;

export type DirectionItem = {
  label: string;
  text: string;
  current?: boolean;
};

export const DIRECTION: readonly DirectionItem[] = [
  {
    label: "Objective",
    text: "Ship the EGA operating loop",
  },
  {
    label: "Current milestone",
    text: "Make daily execution observable",
    current: true,
  },
  {
    label: "Next action",
    text: "Close the homepage delivery slice",
  },
] as const;
