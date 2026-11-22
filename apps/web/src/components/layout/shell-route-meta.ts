export type ShellRouteMeta = {
  href: `/${string}`;
  label: string;
  group: "primary" | "system";
  /** Short page-purpose line shown as top-bar context. */
  description: string;
};

export const COMMAND_ROUTES = [
  { href: "/today", label: "Today", group: "primary", description: "Daily execution" },
  { href: "/tasks", label: "Tasks", group: "primary", description: "Work inventory" },
  { href: "/tasks/projects", label: "Projects", group: "primary", description: "Workspaces" },
  { href: "/money", label: "Money", group: "primary", description: "Personal expense ledger" },
  { href: "/review", label: "Review", group: "primary", description: "Weekly feedback loop" },
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
  { href: "/notifications", label: "Notifications", group: "system", description: "Reminders" },
  { href: "/startup", label: "Startup", group: "system", description: "Start the day" },
  { href: "/shutdown", label: "Shutdown", group: "system", description: "Close the day" },
  { href: "/apps", label: "Apps", group: "system", description: "Connected surfaces" },
  {
    href: "/agents",
    label: "Agents",
    group: "system",
    description: "Agent identities and credentials",
  },
  { href: "/help", label: "Help", group: "system", description: "Support and shortcuts" },
  {
    href: "/settings/account",
    label: "Settings",
    group: "system",
    description: "Account controls",
  },
] as const satisfies readonly ShellRouteMeta[];

const ALL_ROUTES: readonly ShellRouteMeta[] = [
  ...COMMAND_ROUTES,
  ...SYSTEM_ROUTES,
  // Settings sub-pages are reachable from the in-page section navigation; they
  // still need metadata so the top-bar context does not fall back to Workspace.
  { href: "/settings/appearance", label: "Appearance", group: "system", description: "Theme and density" },
  { href: "/settings/preferences", label: "Preferences", group: "system", description: "Launch and task defaults" },
];

const FALLBACK_ROUTE: ShellRouteMeta = {
  href: "/today",
  label: "Workspace",
  group: "primary",
  description: "Workspace",
};

export function getShellRouteMeta(pathname: string): ShellRouteMeta {
  if (pathname === "/settings" || pathname.startsWith("/settings/")) {
    return ALL_ROUTES.find((route) => route.href === "/settings/account") ?? FALLBACK_ROUTE;
  }

  return (
    ALL_ROUTES.filter(
      (route) => pathname === route.href || pathname.startsWith(`${route.href}/`),
    ).sort((left, right) => right.href.length - left.href.length)[0] ?? FALLBACK_ROUTE
  );
}
