import type { ReactNode } from "react";
import { WorkspacePageHeader } from "@/components/layout/workspace-page-header";

type TasksWorkspaceShellProps = {
  children: ReactNode;
  title?: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
  contentClassName?: string;
};

export function TasksWorkspaceShell({
  children,
  title,
  description,
  actions,
  className,
  contentClassName,
}: TasksWorkspaceShellProps) {
  return (
    <>
      <WorkspacePageHeader title={title} description={description} actions={actions} />
      <div className={className}>
        <div className={contentClassName}>{children}</div>
      </div>
    </>
  );
}
