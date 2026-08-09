import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";

type TasksWorkspaceShellProps = {
  children: ReactNode;
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  navigation?: ReactNode;
  className?: string;
  contentClassName?: string;
};

/** Thin wrapper — instrument-style has no sub-nav (it's in the global sidebar) */
export async function TasksWorkspaceShell({
  children,
  eyebrow,
  title,
  description,
  actions,
  className,
  contentClassName,
}: TasksWorkspaceShellProps) {
  return (
    <AppShell
      eyebrow={eyebrow}
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
