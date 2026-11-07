import type { UserPreferences } from "@ega/domain/preferences";

import { ChoiceGroup } from "@/app/(workspace)/settings/_components/choice-group";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";

import styles from "./appearance.module.css";
import { ReducedMotionHint } from "./reduced-motion-hint";

type AppearancePreferences = Pick<
  UserPreferences,
  "theme" | "accent" | "density" | "reducedMotion"
>;

function ThemePreview({ theme }: { theme: AppearancePreferences["theme"] }) {
  return (
    <span
      className={styles.themePreview}
      data-theme-preview={theme}
      aria-hidden="true"
    >
      <span className={styles.themeRail} />
      <span className={styles.themeCanvas}>
        <span className={styles.themeLine} />
        <span className={styles.themeLineShort} />
      </span>
    </span>
  );
}

function AccentPreview({ accent }: { accent: AppearancePreferences["accent"] }) {
  return (
    <span
      className={styles.accentPreview}
      data-accent-preview={accent}
      aria-hidden="true"
    >
      <span className={styles.accentSwatch} />
      <span className={styles.accentText}>Aa</span>
    </span>
  );
}

function DensityPreview({ density }: { density: AppearancePreferences["density"] }) {
  return (
    <span
      className={styles.densityPreview}
      data-density-preview={density}
      aria-hidden="true"
    >
      <span className={styles.densityRow} />
      <span className={styles.densityRow} />
      <span className={styles.densityRow} />
    </span>
  );
}

const THEME_OPTIONS = [
  {
    value: "system",
    label: "System",
    description: "Follow this device and update when its setting changes.",
    preview: <ThemePreview theme="system" />,
  },
  {
    value: "light",
    label: "Light",
    description: "Always use the light workspace.",
    preview: <ThemePreview theme="light" />,
  },
  {
    value: "dark",
    label: "Dark",
    description: "Always use the dark workspace.",
    preview: <ThemePreview theme="dark" />,
  },
] as const;

const ACCENT_OPTIONS = [
  {
    value: "neutral",
    label: "Neutral",
    description: "Charcoal ink on white or charcoal.",
    preview: <AccentPreview accent="neutral" />,
  },
  {
    value: "blue",
    label: "Blue",
    description: "Cool primary actions and highlights.",
    preview: <AccentPreview accent="blue" />,
  },
  {
    value: "green",
    label: "Green",
    description: "Calm progress-oriented actions.",
    preview: <AccentPreview accent="green" />,
  },
  {
    value: "violet",
    label: "Violet",
    description: "Distinct review-oriented actions.",
    preview: <AccentPreview accent="violet" />,
  },
  {
    value: "amber",
    label: "Amber",
    description: "Warm attention-oriented actions.",
    preview: <AccentPreview accent="amber" />,
  },
] as const;

const DENSITY_OPTIONS = [
  {
    value: "comfortable",
    label: "Comfortable",
    description: "More breathing room between rows.",
    preview: <DensityPreview density="comfortable" />,
  },
  {
    value: "compact",
    label: "Compact",
    description: "Tighter rows; touch targets keep their minimum size.",
    preview: <DensityPreview density="compact" />,
  },
] as const;

/**
 * Appearance form. Values are native radio/checkbox defaults, so the saved
 * selection is correct before hydration and survives a reload. Submission uses
 * the unchanged `updateAppearancePreferencesAction`; only appearance fields are
 * sent, which keeps theme/density independent of the personal schedule.
 */
export function AppearanceForm({
  preferences,
  action,
}: {
  preferences: AppearancePreferences;
  action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <form action={action} className={styles.panel} aria-label="Appearance settings">
      <div className={styles.panelBody}>
        <section className={styles.section} aria-labelledby="appearance-theme-heading">
          <h2 id="appearance-theme-heading" className={styles.sectionHeading}>
            Theme
          </h2>
          <p id="appearance-theme-description" className={styles.sectionDescription}>
            System follows the operating system, including live changes. The
            chosen theme is applied before the page paints.
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
            visuallyHideInput
            visuallyHideLegend
          />
        </section>

        <section className={styles.section} aria-labelledby="appearance-accent-heading">
          <h2 id="appearance-accent-heading" className={styles.sectionHeading}>
            Accent colour
          </h2>
          <p id="appearance-accent-description" className={styles.sectionDescription}>
            Applied to primary actions and highlights. Every choice keeps text
            contrast in both themes.
          </p>
          <ChoiceGroup
            name="accent"
            legend="Accent options"
            value={preferences.accent}
            options={ACCENT_OPTIONS}
            idPrefix="appearance-accent"
            describedBy="appearance-accent-description"
            columns="five"
            layout="row"
            visuallyHideInput
            visuallyHideLegend
          />
        </section>

        <section className={styles.section} aria-labelledby="appearance-density-heading">
          <h2 id="appearance-density-heading" className={styles.sectionHeading}>
            Sidebar and list density
          </h2>
          <p id="appearance-density-description" className={styles.sectionDescription}>
            Compact trims row padding without shrinking touch targets on
            pointer-coarse screens.
          </p>
          <ChoiceGroup
            name="density"
            legend="Density options"
            value={preferences.density}
            options={DENSITY_OPTIONS}
            idPrefix="appearance-density"
            describedBy="appearance-density-description"
            columns="two"
            layout="stack"
            visuallyHideInput
            visuallyHideLegend
          />
        </section>

        <section className={styles.section} aria-labelledby="appearance-motion-heading">
          <h2 id="appearance-motion-heading" className={styles.sectionHeading}>
            Motion
          </h2>
          <label className={styles.motionCard} htmlFor="reducedMotion">
            <span className={styles.motionCopy}>
              <span className={styles.motionTitle}>Reduce motion</span>
              <span id="reducedMotion-help" className={styles.motionDescription}>
                Disables interface animations. Your device&apos;s reduced-motion
                setting always applies too, whichever is stronger.
              </span>
            </span>
            <span className={styles.motionSwitch}>
              <input
                id="reducedMotion"
                type="checkbox"
                name="reducedMotion"
                defaultChecked={preferences.reducedMotion}
                aria-describedby="reducedMotion-help"
                className={styles.motionInput}
              />
              <span className={styles.motionTrack} aria-hidden="true" />
            </span>
          </label>
          <ReducedMotionHint />
        </section>

        <div className={styles.saveRow}>
          <p className={styles.saveNote}>
            These choices are saved separately from the personal schedule.
          </p>
          <PendingSubmitButton type="submit" pendingLabel="Saving…">
            Save appearance
          </PendingSubmitButton>
        </div>
      </div>
    </form>
  );
}
