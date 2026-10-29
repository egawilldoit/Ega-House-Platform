import Link from "next/link";

const SECTIONS = [
  { key: "account", href: "/settings/account", label: "Account" },
  { key: "appearance", href: "/settings/appearance", label: "Appearance" },
  { key: "preferences", href: "/settings/preferences", label: "Preferences" },
] as const;

export type SettingsSectionKey = (typeof SECTIONS)[number]["key"];

/**
 * Settings section navigation.
 *
 * Plain links with `aria-current` so keyboard and assistive-technology users get
 * the same orientation as the visible active state. The sidebar keeps a single
 * Settings entry; sections live here.
 */
export function SettingsNav({ active }: { active: SettingsSectionKey }) {
  return (
    <nav aria-label="Settings sections" className="settings-nav">
      {SECTIONS.map((section) => (
        <Link
          key={section.key}
          href={section.href}
          className="settings-nav-link"
          aria-current={section.key === active ? "page" : undefined}
        >
          {section.label}
        </Link>
      ))}
    </nav>
  );
}
