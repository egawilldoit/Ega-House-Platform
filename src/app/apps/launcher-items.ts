export type AppsLauncherIconKey =
  | "dashboard"
  | "tasks"
  | "timer"
  | "goals"
  | "review";

export type AppsLauncherItem = {
  id: string;
  label: string;
  description: string;
  href: `/${string}`;
  icon: AppsLauncherIconKey;
  available: boolean;
};

export const APPS_LAUNCHER_ITEMS: AppsLauncherItem[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    description: "Operational snapshot for today and this week.",
    href: "/dashboard",
    icon: "dashboard",
    available: true,
  },
  {
    id: "tasks",
    label: "Tasks",
    description: "Capture, plan, and execute the active queue.",
    href: "/tasks",
    icon: "tasks",
    available: true,
  },
  {
    id: "timer",
    label: "Timer",
    description: "Run focused sessions and track execution time.",
    href: "/timer",
    icon: "timer",
    available: true,
  },
  {
    id: "goals",
    label: "Goals",
    description: "Define intent and keep work tied to outcomes.",
    href: "/goals",
    icon: "goals",
    available: true,
  },
  {
    id: "review",
    label: "Review",
    description: "Close the loop with weekly execution review.",
    href: "/review",
    icon: "review",
    available: true,
  },
];
