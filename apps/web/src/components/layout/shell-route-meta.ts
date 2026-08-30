export type ShellRouteMeta = {
  href: `/${string}`;
  index: string;
  label: string;
  group: "command" | "system";
  eyebrow: string;
};

export const COMMAND_ROUTES = [
  {
    href: "/today",
    index: "01",
    label: "Today",
    group: "command",
    eyebrow: "Daily execution",
  },
  {
    href: "/tasks",
    index: "02",
    label: "Tasks",
    group: "command",
    eyebrow: "Work inventory",
  },
  {
    href: "/goals",
    index: "03",
    label: "Goals",
    group: "command",
    eyebrow: "Direction",
  },
  {
    href: "/timer",
    index: "04",
    label: "Timer",
    group: "command",
    eyebrow: "Focus session",
  },
  {
    href: "/review",
    index: "05",
    label: "Review",
    group: "command",
    eyebrow: "Feedback loop",
  },
  {
    href: "/work-analytics",
    index: "06",
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
      href: "/today",
      index: "00",
      label: "Workspace",
      group: "command",
      eyebrow: "Operating system",
    }
  );
}
