"use client";

import Image from "next/image";
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Menu, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { QuickTaskSheet } from "@/components/tasks/quick-task-sheet";
import type { WorkspaceShellMetrics } from "@/lib/workspace-shell";
import { SidebarNavigation, type SidebarGoal, type SidebarProject } from "./sidebar-navigation";

type WorkspaceNavigationDrawerProps = {
  children: ReactNode;
  label?: string;
};

export function WorkspaceNavigationDrawer({
  children,
  label = "Workspace navigation",
}: WorkspaceNavigationDrawerProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const previousOverflowRef = useRef("");
  const reduceMotion = useReducedMotion();

  function closeDrawer({ restoreFocus = true } = {}) {
    setOpen(false);
    if (restoreFocus) {
      queueMicrotask(() => triggerRef.current?.focus());
    }
  }

  useEffect(() => {
    if (!open) return;

    previousOverflowRef.current = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusTarget = panelRef.current?.querySelector<HTMLElement>(
      "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
    );
    focusTarget?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDrawer();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflowRef.current;
    };
  }, [open]);

  function onPanelClick(event: ReactMouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("a[href]")) {
      closeDrawer({ restoreFocus: false });
    }
  }

  return (
    <div className="workspace-mobile-navigation">
      <button
        ref={triggerRef}
        type="button"
        className="workspace-nav-trigger"
        aria-label="Open workspace navigation"
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
          <motion.div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-modal="true"
            aria-label={label}
            className="workspace-drawer-panel"
            initial={reduceMotion ? false : { x: "-100%", opacity: 0.72 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: reduceMotion ? 0 : 0.24, ease: [0.22, 1, 0.36, 1] }}
            onClickCapture={onPanelClick}
          >
            {children}
            <button
              type="button"
              className="workspace-drawer-close"
              aria-label="Close workspace navigation panel"
              onClick={() => closeDrawer()}
            >
              <X aria-hidden="true" />
              Close
            </button>
          </motion.div>
        </div>
      ) : null}
    </div>
  );
}

type SidebarMobileDrawerProps = {
  projects?: SidebarProject[];
  goals?: SidebarGoal[];
  metrics: WorkspaceShellMetrics;
};

export function SidebarMobileDrawer({
  projects = [],
  goals = [],
  metrics,
}: SidebarMobileDrawerProps) {
  return (
    <WorkspaceNavigationDrawer>
      <div className="workspace-drawer-brand">
        <Image src="/logo.svg" alt="" width={38} height={38} className="sidebar-brand-logo" />
        <div>
          <strong>EGA House</strong>
          <span>Operating system</span>
        </div>
        <small>OS / MOBILE</small>
      </div>
      <div className="workspace-drawer-quick-task">
        <QuickTaskSheet projects={projects} goals={goals} />
      </div>
      <SidebarNavigation projects={projects} metrics={metrics} />
    </WorkspaceNavigationDrawer>
  );
}
