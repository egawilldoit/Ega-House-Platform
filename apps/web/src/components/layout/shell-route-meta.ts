export type ShellRouteMeta = {
  href: `/${string}`;
  label: string;
  group: "primary" | "system";
  /** Short page-purpose line shown as top-bar context. */
  description: string;
};

export const COMMAND_ROUTES = [
  { href: "/home", label: "Home", group: "primary", description: "Workspace overview" },
  { href: "/today", label: "Today", group: "primary", description: "Daily execution" },
  { href: "/tasks", label: "Tasks", group: "primary", description: "Work inventory" },
  { href: "/goals", label: "Goals", group: "primary", description: "Direction and progress" },
  { href: "/timer", label: "Timer", group: "primary", description: "Focus session" },
  { href: "/review", label: "Review", group: "primary", description: "Weekly feedback loop" },
  {
    href: "/work-analytics",
    label: "Analytics",
    group: "primary",
    description: "Operational evidence",
  },
] as const satisfies readonly ShellRouteMeta[];

export const SYSTEM_ROUTES = [
  { href: "/ideas", label: "Ideas", group: "system", description: "Capture inbox" },
  { href: "/notifications", label: "Notifications", group: "system", description: "Reminders" },
  { href: "/startup", label: "Startup", group: "system", description: "Start the day" },
  { href: "/shutdown", label: "Shutdown", group: "system", description: "Close the day" },
  { href: "/apps", label: "Apps", group: "system", description: "Connected surfaces" },
  { href: "/help", label: "Help", group: "system", description: "Support and shortcuts" },
  {
    href: "/settings/account",
    label: "Settings",
    group: "system",
    description: "Account controls",
  },
] as const satisfies readonly ShellRouteMeta[];

const ALL_ROUTES: readonly ShellRouteMeta[] = [...COMMAND_ROUTES, ...SYSTEM_ROUTES];

const FALLBACK_ROUTE: ShellRouteMeta = {
  href: "/today",
  label: "Workspace",
  group: "primary",
  description: "Workspace",
};

export function getShellRouteMeta(pathname: string): ShellRouteMeta {
  return (
    ALL_ROUTES.filter(
      (route) => pathname === route.href || pathname.startsWith(`${route.href}/`),
    ).sort((left, right) => right.href.length - left.href.length)[0] ?? FALLBACK_ROUTE
  );
}
