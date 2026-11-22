import type { UserPreferences } from "@ega/domain/preferences";

import { ChoiceGroup } from "@/app/(workspace)/settings/_components/choice-group";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";

import { ReducedMotionHint } from "./reduced-motion-hint";

type AppearancePreferences = Pick<UserPreferences, "theme" | "reducedMotion">;

const THEME_OPTIONS = [
  {
    value: "system",
    label: "System",
    description: "Follow this device and update when its setting changes.",
  },
  {
    value: "light",
    label: "Light",
    description: "Always use the light workspace.",
  },
  {
    value: "dark",
    label: "Dark",
    description: "Always use the dark workspace.",
  },
] as const;

/**
 * Appearance form. Light/Dark/System and reduced motion are the only appearance
 * preferences; accent colour and global UI density are retired. Values are
 * native radio/checkbox defaults, so the saved choice is correct before
 * hydration.
 */
export function AppearanceSettings({
  preferences,
  action,
}: {
  preferences: AppearancePreferences;
  action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <form action={action} aria-label="Appearance settings" className="flex flex-col gap-5">
      <section aria-labelledby="appearance-theme-heading" className="flex flex-col gap-2">
        <h2 id="appearance-theme-heading" className="text-[length:var(--text-section)] font-semibold">
          Theme
        </h2>
        <p id="appearance-theme-description" className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
          System follows the operating system, including live changes. The chosen
          theme is applied before the page paints.
        </p>
        <ChoiceGroup
          name="theme"
          legend="Theme options"
          value={preferences.theme}
          options={THEME_OPTIONS}
          idPrefix="appearance-theme"
          describedBy="appearance-theme-description"
          columns="three"
          layout="stack"
          visuallyHideLegend
        />
      </section>

      <section aria-labelledby="appearance-motion-heading" className="flex flex-col gap-2">
        <h2 id="appearance-motion-heading" className="text-[length:var(--text-section)] font-semibold">
          Motion
        </h2>
        <label
          htmlFor="reducedMotion"
          className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--ega-border)] p-3"
        >
          <input
            id="reducedMotion"
            type="checkbox"
            name="reducedMotion"
            defaultChecked={preferences.reducedMotion}
            aria-describedby="reducedMotion-help"
            className="mt-0.5 h-4 w-4"
          />
          <span className="min-w-0">
            <span className="block text-[length:var(--text-body)] font-medium">Reduce motion</span>
            <span
              id="reducedMotion-help"
              className="mt-1 block text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]"
            >
              Disables interface animations. Your device&apos;s reduced-motion
              setting always applies too, whichever is stronger.
            </span>
          </span>
        </label>
        <ReducedMotionHint />
      </section>

      <div>
        <PendingSubmitButton type="submit" pendingLabel="Saving…">
          Save appearance
        </PendingSubmitButton>
      </div>
    </form>
  );
}
