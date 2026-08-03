import type { HomeStudy } from "./home.types";

export const LOGIN_HREF = "/login?next=%2Fdashboard";
export const SIGNUP_HREF = "/signup";

export const HOME_STUDIES: readonly HomeStudy[] = [
  {
    id: "intro",
    index: "00",
    discipline: "SYSTEM",
    artDirection: "SIGNAL / CREAM",
    theme: "signal",
    title: "Introduction",
    headline: "One operating system for turning intention into execution.",
    description:
      "Goals, tasks, focus sessions, and weekly review stay connected in one operational workspace.",
  },
  {
    id: "goals",
    index: "01",
    discipline: "GOALS",
    artDirection: "SEA GLASS",
    theme: "sea-glass",
    title: "Goals",
    headline: "Quiet structure. Loud intent.",
    description:
      "Turn long-range direction into a visible hierarchy of objectives, milestones, and next actions.",
  },
  {
    id: "planning",
    index: "02",
    discipline: "PLANNING",
    artDirection: "TERRACOTTA",
    theme: "terracotta",
    title: "Planning",
    headline: "Move the plan into motion without adding noise.",
    description:
      "Link operational work to the goals it serves, then make workload, priority, and timing explicit.",
  },
  {
    id: "focus",
    index: "03",
    discipline: "FOCUS",
    artDirection: "CITRUS BLACK",
    theme: "citrus",
    title: "Focus",
    headline: "Turn attention into momentum.",
    description:
      "Run focused sessions against active work while preserving the context that made the task matter.",
  },
  {
    id: "review",
    index: "04",
    discipline: "REVIEW",
    artDirection: "CREAM / TEAL",
    theme: "review",
    title: "Review",
    headline: "Review the evidence. Correct the system.",
    description:
      "Close the loop with completed work, unresolved friction, lessons, and the next correction.",
  },
  {
    id: "workspace",
    index: "05",
    discipline: "WORKSPACE",
    artDirection: "BLACK SIGNAL",
    theme: "conversion",
    title: "Workspace",
    headline: "Build the week. Run the day. Review the system.",
    description:
      "Create your EGA House workspace or return to the operating system you already use.",
  },
] as const;

export const getStudy = (id: HomeStudy["id"]): HomeStudy => {
  const study = HOME_STUDIES.find((item) => item.id === id);

  if (!study) {
    throw new Error(`Unknown homepage study: ${id}`);
  }

  return study;
};
