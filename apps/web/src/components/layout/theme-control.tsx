"use client";

import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { updateThemePreferenceAction } from "@/app/(workspace)/settings/appearance/actions";
import { useWorkspacePreferences } from "@/components/layout/workspace-preferences-provider";
import type { WorkspaceThemePreference } from "@/lib/theme-preference";
import { applyWorkspaceThemeToDocument, watchSystemTheme } from "@/lib/theme-preference.client";
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
 *
 * The durable owner is the `user_preferences` row. This control paints the
 * choice immediately, saves it through the server action, and rolls back to the
 * server value with an inline alert when the write fails. The server value is
 * the only persisted copy: an account switch re-renders the provider and this
 * local mirror follows it.
 */
export function ThemeControl({ className }: { className?: string }) {
  const { theme: serverTheme } = useWorkspacePreferences();
  // A local selection is only valid while the server value it was based on is
  // still current. When a save re-renders the provider (or an account switch
  // delivers a different owner), the server value wins without an effect.
  const [draft, setDraft] = useState<{
    base: WorkspaceThemePreference;
    value: WorkspaceThemePreference;
  } | null>(null);
  const selectedTheme = draft && draft.base === serverTheme ? draft.value : serverTheme;
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const activeOption =
    THEME_OPTIONS.find((option) => option.value === selectedTheme) ?? THEME_OPTIONS[2];
  const ActiveIcon = activeOption.icon;

  useEffect(() => {
    applyWorkspaceThemeToDocument(selectedTheme);
    return watchSystemTheme(selectedTheme, () =>
      applyWorkspaceThemeToDocument(selectedTheme),
    );
  }, [selectedTheme]);

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

  const selectTheme = async (next: WorkspaceThemePreference) => {
    setErrorMessage(null);
    const details = detailsRef.current;
    if (details) {
      details.open = false;
      details.querySelector<HTMLElement>("summary")?.focus();
    }

    if (next === selectedTheme) return;

    const previous = selectedTheme;
    setDraft({ base: serverTheme, value: next });
    applyWorkspaceThemeToDocument(next);

    let result: { errorMessage: string | null } | null = null;
    try {
      result = await updateThemePreferenceAction(next);
    } catch {
      result = { errorMessage: "Unable to save preferences right now." };
    }

    if (result?.errorMessage) {
      setDraft(null);
      applyWorkspaceThemeToDocument(previous);
      setErrorMessage(result.errorMessage);
      // Reopen so the inline alert is perceivable; focus stays on the trigger
      // and role="alert" announces the message.
      if (detailsRef.current) detailsRef.current.open = true;
    }
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
          const active = option.value === selectedTheme;
          return (
            <button
              key={option.value}
              type="button"
              className="theme-control-option"
              aria-pressed={active}
              onClick={() => void selectTheme(option.value)}
            >
              <Icon className="theme-control-option-icon" aria-hidden="true" />
              <span className="theme-control-option-label">{option.label}</span>
              {active ? (
                <Check className="theme-control-option-check" aria-hidden="true" />
              ) : null}
            </button>
          );
        })}
        {errorMessage ? (
          <p role="alert" className="theme-control-error">
            {errorMessage}
          </p>
        ) : null}
      </div>
    </details>
  );
}
