import type { ReactNode } from "react";

export function WorkspaceContentSkeleton({ children }: { children: ReactNode }) {
  return (
    <div data-workspace-route-loading aria-busy="true">
      {children}
    </div>
  );
}
