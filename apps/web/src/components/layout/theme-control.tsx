"use client";

import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useRef } from "react";

import {
  setWorkspaceThemePreference,
  useWorkspaceThemePreference,
} from "@/lib/hooks/workspace-theme";
import type { WorkspaceThemePreference } from "@/lib/theme-preference";
import { cn } from "@/lib/utils";

const THEME_OPTIONS: ReadonlyArray<{
  value: WorkspaceThemePreference;
  label: string;
  icon: typeof Sun;
}> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

/**
 * Three-choice theme control.
 *
 * A native disclosure keeps the top bar compact on phones while exposing the
 * full Light / Dark / System vocabulary with visible labels. `aria-pressed`
 * carries the active choice, so it is never communicated by colour alone.
 */
export function ThemeControl({ className }: { className?: string }) {
  const preference = useWorkspaceThemePreference();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const activeOption =
    THEME_OPTIONS.find((option) => option.value === preference) ?? THEME_OPTIONS[2];
  const ActiveIcon = activeOption.icon;

  useEffect(() => {
    const details = detailsRef.current;
    if (!details) return;

    const closeIfOutside = (event: PointerEvent) => {
      if (!details.open) return;
      const target = event.target;
      if (target instanceof Node && details.contains(target)) return;
      details.open = false;
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !details.open) return;
      event.preventDefault();
      const active = document.activeElement;
      const focusIsInside = active instanceof Node && details.contains(active);
      details.open = false;
      if (focusIsInside) {
        details.querySelector<HTMLElement>("summary")?.focus();
      }
    };

    document.addEventListener("pointerdown", closeIfOutside);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeIfOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const selectTheme = (next: WorkspaceThemePreference) => {
    setWorkspaceThemePreference(next);
    const details = detailsRef.current;
    if (!details) return;
    details.open = false;
    details.querySelector<HTMLElement>("summary")?.focus();
  };

  return (
    <details ref={detailsRef} className={cn("theme-control", className)}>
      <summary
        className="theme-control-trigger"
        aria-label={`Theme: ${activeOption.label}. Change theme`}
        title={`Theme: ${activeOption.label}`}
      >
        <ActiveIcon aria-hidden="true" />
      </summary>

      <div className="theme-control-menu" role="group" aria-label="Theme preference">
        {THEME_OPTIONS.map((option) => {
          const Icon = option.icon;
          const active = option.value === preference;
          return (
            <button
              key={option.value}
              type="button"
              className="theme-control-option"
              aria-pressed={active}
              onClick={() => selectTheme(option.value)}
            >
              <Icon className="theme-control-option-icon" aria-hidden="true" />
              <span className="theme-control-option-label">{option.label}</span>
              {active ? (
                <Check className="theme-control-option-check" aria-hidden="true" />
              ) : null}
            </button>
          );
        })}
      </div>
    </details>
  );
}
