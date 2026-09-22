"use client";

import Image from "next/image";
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Menu, X } from "lucide-react";

import { InboxCaptureTrigger } from "@/components/inbox/inbox-capture-trigger";
import type { WorkspaceShellMetrics } from "@/lib/workspace-shell";
import { SidebarCreateTaskButton } from "./sidebar-create-task";
import { SidebarNavigation, type SidebarProject } from "./sidebar-navigation";
import { WorkspaceDrawerContext } from "./workspace-drawer-context";
import { WorkspaceSearchTrigger } from "./workspace-search-trigger";

type WorkspaceNavigationDrawerProps = {
  children: ReactNode;
  label?: string;
};

const DRAWER_FOCUSABLE_SELECTOR =
  "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

function getVisibleFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(DRAWER_FOCUSABLE_SELECTOR)).filter(
    (element) => {
      let ancestor: HTMLElement | null = element;

      while (ancestor && ancestor !== container) {
        const style = window.getComputedStyle(ancestor);
        if (
          ancestor.hasAttribute("inert") ||
          ancestor.getAttribute("aria-hidden") === "true" ||
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.visibility === "collapse" ||
          style.opacity === "0"
        ) {
          return false;
        }

        ancestor = ancestor.parentElement;
      }

      return true;
    },
  );
}

export function WorkspaceNavigationDrawer({
  children,
  label = "Workspace navigation",
}: WorkspaceNavigationDrawerProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const previousOverflowRef = useRef("");

  const closeDrawer = useCallback((options?: { restoreFocus?: boolean }) => {
    const restoreFocus = options?.restoreFocus ?? true;
    setOpen(false);
    if (restoreFocus) {
      queueMicrotask(() => triggerRef.current?.focus());
    }
  }, []);

  const drawerControls = useMemo(() => ({ closeDrawer }), [closeDrawer]);

  useEffect(() => {
    if (!open) return;

    previousOverflowRef.current = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const panel = panelRef.current;
    const focusTarget = panel ? getVisibleFocusableElements(panel)[0] : undefined;
    if (focusTarget) {
      focusTarget.focus();
    } else {
      panel?.focus();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDrawer();
        return;
      }

      if (event.key !== "Tab" || !panelRef.current) return;

      const focusable = getVisibleFocusableElements(panelRef.current);

      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      const activeIndex = focusable.indexOf(activeElement as HTMLElement);

      if (activeIndex === -1) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && activeIndex === 0) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeIndex === focusable.length - 1) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflowRef.current;
    };
  }, [closeDrawer, open]);

  function onPanelClick(event: ReactMouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("a[href]")) {
      closeDrawer({ restoreFocus: false });
    }
  }

  return (
    <WorkspaceDrawerContext.Provider value={drawerControls}>
      <div className="workspace-mobile-navigation">
        <button
          ref={triggerRef}
          type="button"
          className="workspace-nav-trigger"
          aria-label="Open workspace navigation"
          title="Open workspace navigation"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen(true)}
        >
          <Menu aria-hidden="true" />
          <span>Menu</span>
        </button>

        {open ? (
          <div className="workspace-drawer-layer">
            <button
              type="button"
              className="workspace-drawer-backdrop"
              aria-label="Close workspace navigation"
              onClick={() => closeDrawer()}
            />
            <div
              ref={panelRef}
              id={panelId}
              role="dialog"
              aria-modal="true"
              aria-label={label}
              tabIndex={-1}
              className="workspace-drawer-panel workspace-drawer-panel-enter"
              onClickCapture={onPanelClick}
            >
              {children}
              <button
                type="button"
                className="workspace-drawer-close"
                aria-label="Close workspace navigation panel"
                title="Close workspace navigation panel"
                onClick={() => closeDrawer()}
              >
                <X aria-hidden="true" />
                Close
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </WorkspaceDrawerContext.Provider>
  );
}

type SidebarMobileDrawerProps = {
  projects?: SidebarProject[];
  metrics: WorkspaceShellMetrics;
};

export function SidebarMobileDrawer({
  projects = [],
  metrics,
}: SidebarMobileDrawerProps) {
  return (
    <WorkspaceNavigationDrawer>
      <div className="workspace-drawer-brand">
        <Image src="/logo.svg" alt="" width={26} height={26} className="sidebar-brand-logo" />
        <div>
          <strong>EGA House</strong>
        </div>
      </div>
      <div className="px-1.5 pb-1">
        <WorkspaceSearchTrigger />
      </div>
      <SidebarNavigation projects={projects} metrics={metrics} />
      <div className="mt-1 flex flex-col gap-1.5 border-t border-[var(--ega-border)] px-1.5 pt-2">
        <InboxCaptureTrigger />
        <SidebarCreateTaskButton />
      </div>
    </WorkspaceNavigationDrawer>
  );
}
