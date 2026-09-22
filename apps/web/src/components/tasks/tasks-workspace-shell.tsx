import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";

type TasksWorkspaceShellProps = {
  children: ReactNode;
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
  contentClassName?: string;
};

/** Thin wrapper — the page header lives in the shared `AppShell`. */
export async function TasksWorkspaceShell({
  children,
  title,
  description,
  actions,
  className,
  contentClassName,
}: TasksWorkspaceShellProps) {
  return (
    <AppShell
      title={title}
      description={description}
      actions={actions}
      className={className}
      contentClassName={contentClassName}
    >
      {children}
    </AppShell>
  );
}
