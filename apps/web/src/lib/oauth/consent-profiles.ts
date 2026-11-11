import {
  profileHasWritePermission,
  type McpPermissionProfile,
} from "@/lib/mcp/permissions";

/**
 * The single consent choice list shared by the page and the decision service.
 *
 * `writes` is derived from the profile's permission union, so a new
 * write-capable profile can never be offered while writes are off. A posted
 * `permission_profile` that is not in this list (for example the legacy
 * `task_manager`, which this UI has never offered) is refused rather than
 * silently issued.
 */
export type ConsentProfileChoice = Readonly<{
  value: McpPermissionProfile;
  label: string;
  description: string;
  writes: boolean;
}>;

const CHOICES: ReadonlyArray<Omit<ConsentProfileChoice, "writes">> = [
  {
    value: "read_only",
    label: "Workspace read-only",
    description:
      "List projects, goals, tasks, Today plan and timer sessions. No Money access.",
  },
  {
    value: "personal_operations",
    label: "Money read-only",
    description:
      "Read recorded MAD spending, the operating summary and daily check-ins. No writes.",
  },
  {
    value: "workspace_money_reader",
    label: "Workspace + Money read-only",
    description:
      "Read workspace items and recorded MAD spending in one connection. No writes.",
  },
  {
    value: "workspace_manager",
    label: "Workspace management",
    description:
      "Read plus create/update projects, goals, tasks, Today and timers. No Money access.",
  },
  {
    value: "personal_operations_writer",
    label: "Money management",
    description:
      "Record and correct MAD expenses and daily check-ins. Owner-scoped and client-bound.",
  },
  {
    value: "workspace_money_writer",
    label: "Workspace + Money management",
    description:
      "Workspace management plus recording and correcting Money. The combined explicit union.",
  },
];

export const CONSENT_PROFILE_CHOICES: readonly ConsentProfileChoice[] =
  CHOICES.map((choice) => ({
    ...choice,
    writes: profileHasWritePermission(choice.value),
  }));

export function consentProfilesForWritesEnabled(
  writesEnabled: boolean,
): readonly ConsentProfileChoice[] {
  return writesEnabled
    ? CONSENT_PROFILE_CHOICES
    : CONSENT_PROFILE_CHOICES.filter((choice) => !choice.writes);
}

export function isConsentProfileOffered(
  profile: McpPermissionProfile,
  writesEnabled: boolean,
): boolean {
  return consentProfilesForWritesEnabled(writesEnabled).some(
    (choice) => choice.value === profile,
  );
}
