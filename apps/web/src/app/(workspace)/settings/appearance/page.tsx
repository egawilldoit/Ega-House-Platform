import { WorkspacePageHeader } from "@/components/layout/workspace-page-header";
import type { Metadata } from "next";

import { updateAppearancePreferencesAction } from "@/app/(workspace)/settings/appearance/actions";
import { ChoiceGroup } from "@/app/(workspace)/settings/_components/choice-group";
import { SettingsNav } from "@/app/(workspace)/settings/_components/settings-nav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { getWebUserPreferencesState } from "@/lib/services/user-preferences-service";

export const metadata: Metadata = {
  title: "Appearance",
  description: "Theme, accent, density and motion preferences.",
};

const THEME_OPTIONS = [
  { value: "system", label: "System", description: "Follow this device's setting." },
  { value: "light", label: "Light", description: "Always use the light workspace." },
  { value: "dark", label: "Dark", description: "Always use the dark workspace." },
] as const;

const ACCENT_OPTIONS = [
  { value: "neutral", label: "Neutral", description: "Charcoal ink on white or charcoal." },
  { value: "blue", label: "Blue", description: "Cool primary actions and highlights." },
  { value: "green", label: "Green", description: "Calm progress-oriented actions." },
  { value: "violet", label: "Violet", description: "Distinct review-oriented actions." },
  { value: "amber", label: "Amber", description: "Warm attention-oriented actions." },
] as const;

const DENSITY_OPTIONS = [
  { value: "comfortable", label: "Comfortable", description: "More breathing room between rows." },
  {
    value: "compact",
    label: "Compact",
    description: "Tighter rows; touch targets keep their minimum size.",
  },
] as const;

type AppearanceSettingsPageProps = {
  searchParams: Promise<{ success?: string; error?: string }>;
};

export default async function AppearanceSettingsPage({
  searchParams,
}: AppearanceSettingsPageProps) {
  const [{ success, error }, state] = await Promise.all([
    searchParams,
    getWebUserPreferencesState(),
  ]);
  const preferences = state.preferences;
  const loadError = error ?? state.errorMessage;

  return (
    <>
<div className="flex max-w-3xl flex-col gap-6">
        <SettingsNav active="appearance" />

        {loadError ? (
          <div role="alert" className="feedback-block feedback-block-error">
            {loadError} The defaults are shown; saving replaces the stored values.
          </div>
        ) : null}

        {success ? (
          <div role="status" className="feedback-block feedback-block-success">
            {success}
          </div>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
            <CardDescription>
              These choices are stored on your account and applied before the page paints.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={updateAppearancePreferencesAction} className="flex flex-col gap-6">
              <ChoiceGroup
                name="theme"
                legend="Theme"
                description="System follows the operating system, including live changes."
                value={preferences.theme}
                options={THEME_OPTIONS}
                idPrefix="appearance-theme"
              />

              <ChoiceGroup
                name="accent"
                legend="Accent colour"
                description="Applied to primary actions and highlights. Every choice keeps text contrast in both themes."
                value={preferences.accent}
                options={ACCENT_OPTIONS}
                idPrefix="appearance-accent"
              />

              <ChoiceGroup
                name="density"
                legend="Sidebar and list density"
                description="Compact trims row padding without shrinking touch targets on pointer-coarse screens."
                value={preferences.density}
                options={DENSITY_OPTIONS}
                idPrefix="appearance-density"
              />

              <div className="flex items-start gap-3">
                <input
                  id="reducedMotion"
                  type="checkbox"
                  name="reducedMotion"
                  defaultChecked={preferences.reducedMotion}
                  aria-describedby="reducedMotion-help"
                  className="mt-0.5 h-4 w-4 accent-[var(--ega-ink)]"
                />
                <div className="min-w-0">
                  <label
                    htmlFor="reducedMotion"
                    className="block text-[length:var(--text-body)] font-medium text-ega-text"
                  >
                    Reduce motion
                  </label>
                  <p
                    id="reducedMotion-help"
                    className="mt-1 block text-[length:var(--text-meta)] text-ega-text-secondary"
                  >
                    Disables interface animations. Your device&apos;s reduced-motion setting
                    always applies too, whichever is stronger.
                  </p>
                </div>
              </div>

              <div>
                <PendingSubmitButton type="submit" pendingLabel="Saving...">
                  Save appearance
                </PendingSubmitButton>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
</>
  );
}
