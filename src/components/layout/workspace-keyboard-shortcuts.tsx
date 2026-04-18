"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import {
  SHORTCUT_ROUTE_MAP,
  SHORTCUT_ROUTE_SEQUENCE,
  SHORTCUT_SEQUENCE_TIMEOUT_MS,
  getShortcutRouteFromSequenceKey,
  isEditableShortcutTarget,
  isExactShortcutCombo,
  shouldOpenShortcutHelp,
} from "@/lib/keyboard-shortcuts";

import { ShortcutHelpSheet } from "./shortcut-help-sheet";

const QUICK_TASK_EVENT = "ega:open-quick-task";
const SHORTCUT_HELP_EVENT = "ega:open-shortcut-help";
const SHORTCUT_NAVIGATION_MARKER = "ega:shortcut-route-target";

function dispatchShortcutEvent(eventName: string) {
  window.dispatchEvent(new CustomEvent(eventName));
}

function setShortcutNavigationMarker(pathname: string) {
  window.sessionStorage.setItem(SHORTCUT_NAVIGATION_MARKER, pathname);
}

function readShortcutNavigationMarker() {
  return window.sessionStorage.getItem(SHORTCUT_NAVIGATION_MARKER);
}

function clearShortcutNavigationMarker() {
  window.sessionStorage.removeItem(SHORTCUT_NAVIGATION_MARKER);
}

export function focusShellHeadingFromShortcutNavigation(currentPathname: string) {
  if (typeof window === "undefined") {
    return;
  }

  const marker = readShortcutNavigationMarker();
  if (marker !== currentPathname) {
    return;
  }

  window.requestAnimationFrame(() => {
    const heading = document.querySelector<HTMLElement>("[data-shell-page-title]");
    heading?.focus();
    clearShortcutNavigationMarker();
  });
}

export function WorkspaceKeyboardShortcuts() {
  const pathname = usePathname();
  const router = useRouter();
  const [helpOpen, setHelpOpen] = useState(false);
  const navSequenceRef = useRef<string | null>(null);
  const navSequenceResetRef = useRef<number | null>(null);

  useEffect(() => {
    focusShellHeadingFromShortcutNavigation(pathname);
  }, [pathname]);

  useEffect(() => {
    const openHelp = () => setHelpOpen(true);
    window.addEventListener(SHORTCUT_HELP_EVENT, openHelp);

    return () => {
      window.removeEventListener(SHORTCUT_HELP_EVENT, openHelp);
    };
  }, []);

  useEffect(() => {
    const resetNavSequence = () => {
      navSequenceRef.current = null;
      if (navSequenceResetRef.current !== null) {
        window.clearTimeout(navSequenceResetRef.current);
        navSequenceResetRef.current = null;
      }
    };

    const beginNavSequence = () => {
      navSequenceRef.current = SHORTCUT_ROUTE_SEQUENCE;
      if (navSequenceResetRef.current !== null) {
        window.clearTimeout(navSequenceResetRef.current);
      }
      navSequenceResetRef.current = window.setTimeout(resetNavSequence, SHORTCUT_SEQUENCE_TIMEOUT_MS);
    };

    const navigateToShortcutRoute = (route: `/${string}`) => {
      if (route !== pathname) {
        setShortcutNavigationMarker(route);
        router.push(route);
        return;
      }

      focusShellHeadingFromShortcutNavigation(route);
      clearShortcutNavigationMarker();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableShortcutTarget(event.target)) {
        return;
      }

      if (shouldOpenShortcutHelp(event)) {
        event.preventDefault();
        setHelpOpen(true);
        resetNavSequence();
        return;
      }

      if (isExactShortcutCombo(event, { key: "a", metaOrCtrl: true, shift: true })) {
        event.preventDefault();
        resetNavSequence();
        navigateToShortcutRoute(SHORTCUT_ROUTE_MAP.apps);
        return;
      }

      if (isExactShortcutCombo(event, { key: "n", metaOrCtrl: true, shift: true })) {
        event.preventDefault();
        resetNavSequence();
        dispatchShortcutEvent(QUICK_TASK_EVENT);
        return;
      }

      if (isExactShortcutCombo(event, { key: "t", metaOrCtrl: true, shift: true })) {
        event.preventDefault();
        resetNavSequence();
        navigateToShortcutRoute(SHORTCUT_ROUTE_MAP.timer);
        return;
      }

      const pressedKey = event.key.toLowerCase();
      if (navSequenceRef.current === SHORTCUT_ROUTE_SEQUENCE) {
        const routeId = getShortcutRouteFromSequenceKey(pressedKey);
        if (routeId) {
          event.preventDefault();
          resetNavSequence();
          navigateToShortcutRoute(SHORTCUT_ROUTE_MAP[routeId]);
          return;
        }

        resetNavSequence();
      }

      if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && pressedKey === SHORTCUT_ROUTE_SEQUENCE) {
        beginNavSequence();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      resetNavSequence();
    };
  }, [pathname, router]);

  return <ShortcutHelpSheet open={helpOpen} onOpenChange={setHelpOpen} />;
}

export const workspaceShortcutEvents = {
  openHelp: SHORTCUT_HELP_EVENT,
  openQuickTask: QUICK_TASK_EVENT,
};
