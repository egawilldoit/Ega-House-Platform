import Link from "next/link";

export const SETTINGS_TABS = [
  {
    key: "account",
    label: "Account",
    description: "Identity, time zone and account-level access.",
  },
  {
    key: "preferences",
    label: "Preferences",
    description: "Theme, notifications and daily work targets.",
  },
  {
    key: "integrations",
    label: "Integrations",
    description: "Calendar, agent credentials and Hermes.",
  },
] as const;

export type SettingsTabKey = (typeof SETTINGS_TABS)[number]["key"];

export const DEFAULT_SETTINGS_TAB: SettingsTabKey = "account";

/** Unknown or missing tab values fall back to Account. */
export function parseSettingsTab(value: string | null | undefined): SettingsTabKey {
  return SETTINGS_TABS.some((tab) => tab.key === value)
    ? (value as SettingsTabKey)
    : DEFAULT_SETTINGS_TAB;
}

/**
 * URL-backed settings tabs.
 *
 * Each tab is a real link so a tab is deep-linkable, survives reload and works
 * before hydration. `aria-current` carries the active state to assistive
 * technology while the visual treatment stays a tab strip.
 */
export function SettingsTabs({ active }: { active: SettingsTabKey }) {
  return (
    <nav aria-label="Settings sections" className="settings-nav">
      {SETTINGS_TABS.map((tab) => (
        <Link
          key={tab.key}
          href={`/settings?tab=${tab.key}`}
          className="settings-nav-link"
          aria-current={tab.key === active ? "page" : undefined}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
