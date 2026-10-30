"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import { getShellRouteMeta } from "./shell-route-meta";

type WorkspacePageHeaderProps = {
  title?: string;
  description?: string;
  actions?: ReactNode;
  hideHeader?: boolean;
};

export function WorkspacePageHeader({
  title,
  description,
  actions,
  hideHeader = false,
}: WorkspacePageHeaderProps) {
  const pathname = usePathname();
  const meta = getShellRouteMeta(pathname);
  const resolvedTitle = title ?? meta.label;
  const resolvedDescription = description ?? meta.description;
  const breadcrumb = meta.group === "primary" && meta.href === "/home" ? "Home" : meta.label;

  if (hideHeader) {
    return null;
  }

  if (!resolvedTitle) {
    return null;
  }

  return (
    <header className="app-page-header">
      <div className="app-page-heading">
        <div className="app-page-eyebrow">{breadcrumb}</div>
        <h1 tabIndex={-1} data-shell-page-title className="app-page-title focus:outline-none">
          {resolvedTitle}
        </h1>
        {resolvedDescription ? <p className="app-page-description">{resolvedDescription}</p> : null}
      </div>
      {actions ? <div className="app-page-actions">{actions}</div> : null}
    </header>
  );
}
