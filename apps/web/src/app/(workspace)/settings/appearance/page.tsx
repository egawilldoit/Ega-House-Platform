import type { Metadata } from "next";

import { updateAppearancePreferencesAction } from "@/app/(workspace)/settings/appearance/actions";
import { AppearanceForm } from "@/app/(workspace)/settings/appearance/appearance-form";
import { SettingsNav } from "@/app/(workspace)/settings/_components/settings-nav";
import { WorkspacePageHeader } from "@/components/layout/workspace-page-header";
import { getWebUserPreferencesState } from "@/lib/services/user-preferences-service";

export const metadata: Metadata = {
  title: "Appearance",
  description: "Theme, accent, density and motion preferences.",
};

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
      <WorkspacePageHeader
        title="Appearance"
        description="Theme, accent, density and motion."
      />
      <div className="flex w-full min-w-0 flex-col gap-6">
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

        <AppearanceForm
          preferences={preferences}
          action={updateAppearancePreferencesAction}
        />
      </div>
    </>
  );
}
