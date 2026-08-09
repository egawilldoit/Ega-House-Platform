export type ShellRouteMeta = {
  href: `/${string}`;
  index: string;
  label: string;
  group: "command" | "system";
  eyebrow: string;
};

export const COMMAND_ROUTES = [
  {
    href: "/dashboard",
    index: "01",
    label: "Dashboard",
    group: "command",
    eyebrow: "Command center",
  },
  {
    href: "/today",
    index: "02",
    label: "Today",
    group: "command",
    eyebrow: "Daily execution",
  },
  {
    href: "/tasks",
    index: "03",
    label: "Tasks",
    group: "command",
    eyebrow: "Work inventory",
  },
  {
    href: "/goals",
    index: "04",
    label: "Goals",
    group: "command",
    eyebrow: "Direction",
  },
  {
    href: "/timer",
    index: "05",
    label: "Timer",
    group: "command",
    eyebrow: "Focus session",
  },
  {
    href: "/review",
    index: "06",
    label: "Review",
    group: "command",
    eyebrow: "Feedback loop",
  },
  {
    href: "/work-analytics",
    index: "07",
    label: "Analytics",
    group: "command",
    eyebrow: "Operational evidence",
  },
] as const satisfies readonly ShellRouteMeta[];

export const SYSTEM_ROUTES = [
  {
    href: "/ideas",
    index: "S1",
    label: "Ideas",
    group: "system",
    eyebrow: "Capture",
  },
  {
    href: "/startup",
    index: "S2",
    label: "Startup",
    group: "system",
    eyebrow: "System ritual",
  },
  {
    href: "/shutdown",
    index: "S3",
    label: "Shutdown",
    group: "system",
    eyebrow: "System ritual",
  },
  {
    href: "/apps",
    index: "S4",
    label: "Apps",
    group: "system",
    eyebrow: "Connected surfaces",
  },
  {
    href: "/help",
    index: "S5",
    label: "Help",
    group: "system",
    eyebrow: "Support",
  },
  {
    href: "/settings/account",
    index: "S6",
    label: "Settings",
    group: "system",
    eyebrow: "Account controls",
  },
] as const satisfies readonly ShellRouteMeta[];

const ALL_ROUTES: readonly ShellRouteMeta[] = [...COMMAND_ROUTES, ...SYSTEM_ROUTES];

export function getShellRouteMeta(pathname: string): ShellRouteMeta {
  return (
    ALL_ROUTES.filter(
      (route) => pathname === route.href || pathname.startsWith(`${route.href}/`),
    ).sort((left, right) => right.href.length - left.href.length)[0] ?? {
      href: "/dashboard",
      index: "00",
      label: "Workspace",
      group: "command",
      eyebrow: "Operating system",
    }
  );
}
