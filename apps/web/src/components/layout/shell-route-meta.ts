export type ShellRouteMeta = {
  href: `/${string}`;
  label: string;
  group: "primary" | "utility" | "system";
  /** Short page-purpose line shown as top-bar context. */
  description: string;
};

/** The primary workspace destinations. */
export const COMMAND_ROUTES = [
  { href: "/today", label: "Today", group: "primary", description: "Daily execution" },
  { href: "/tasks", label: "Tasks", group: "primary", description: "Work inventory" },
  { href: "/tasks/projects", label: "Projects", group: "primary", description: "Workspaces" },
  { href: "/money", label: "Money", group: "primary", description: "Personal expense ledger" },
  { href: "/review", label: "Review", group: "primary", description: "Weekly feedback loop" },
] as const satisfies readonly ShellRouteMeta[];

const TIMER_ROUTE = {
  href: "/timer",
  label: "Timer",
  group: "utility",
  description: "Focus sessions and history",
} as const satisfies ShellRouteMeta;

/** Shared by the desktop sidebar and mobile navigation drawer. */
export const SIDEBAR_ROUTES = [...COMMAND_ROUTES, TIMER_ROUTE] as const;

/** Contextual destinations that are also searchable in the command palette. */
export const UTILITY_ROUTES = [
  {
    href: "/goals",
    label: "Goals",
    group: "utility",
    description: "Cross-project objectives and health",
  },
  TIMER_ROUTE,
] as const satisfies readonly ShellRouteMeta[];

export const SYSTEM_ROUTES = [
  {
    href: "/backlog",
    label: "Backlog",
    group: "system",
    description: "Capture ideas and future work",
  },
  {
    href: "/archive",
    label: "Archive",
    group: "system",
    description: "Restore archived work",
  },
  { href: "/startup", label: "Startup", group: "system", description: "Start the day" },
  { href: "/shutdown", label: "Shutdown", group: "system", description: "Close the day" },
  { href: "/apps", label: "Apps", group: "system", description: "Connected surfaces" },
  {
    href: "/settings",
    label: "Settings",
    group: "system",
    description: "Account, preferences and integrations",
  },
] as const satisfies readonly ShellRouteMeta[];

const ALL_ROUTES: readonly ShellRouteMeta[] = [
  ...COMMAND_ROUTES,
  ...UTILITY_ROUTES,
  ...SYSTEM_ROUTES,
];

const FALLBACK_ROUTE: ShellRouteMeta = {
  href: "/today",
  label: "Workspace",
  group: "primary",
  description: "Workspace",
};

export function getShellRouteMeta(pathname: string): ShellRouteMeta {
  if (pathname === "/settings" || pathname.startsWith("/settings/")) {
    return ALL_ROUTES.find((route) => route.href === "/settings") ?? FALLBACK_ROUTE;
  }

  return (
    ALL_ROUTES.filter(
      (route) => pathname === route.href || pathname.startsWith(`${route.href}/`),
    ).sort((left, right) => right.href.length - left.href.length)[0] ?? FALLBACK_ROUTE
  );
}
