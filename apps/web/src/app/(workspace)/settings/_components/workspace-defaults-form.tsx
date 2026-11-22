import type { UserPreferences } from "@ega/domain/preferences";

import { ChoiceGroup } from "@/app/(workspace)/settings/_components/choice-group";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";

type WorkspaceDefaults = Pick<
  UserPreferences,
  "launchPage" | "taskLayout" | "taskOpenMode"
>;

const LAUNCH_OPTIONS = [
  { value: "home", label: "Home", description: "Overview and current focus." },
  { value: "today", label: "Today", description: "The daily execution plan." },
  { value: "tasks", label: "Tasks", description: "The full work inventory." },
] as const;

const LAYOUT_OPTIONS = [
  { value: "list", label: "List", description: "Dense, sortable rows." },
  { value: "kanban", label: "Kanban", description: "Status columns you can scan across." },
] as const;

const OPEN_MODE_OPTIONS = [
  { value: "panel", label: "Side panel", description: "Keeps the current list in view." },
  { value: "full", label: "Full page", description: "Gives task detail the whole surface." },
] as const;

/**
 * Workspace defaults keep their own server action and save button. Saving them
 * never writes the appearance, notification or work-target preferences.
 */
export function WorkspaceDefaultsForm({
  preferences,
  action,
}: {
  preferences: WorkspaceDefaults;
  action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <form action={action} aria-label="Workspace defaults" className="flex flex-col gap-5">
      <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
        Stored on your account. Controls on a page itself still win for the
        current view.
      </p>

      <ChoiceGroup
        name="launchPage"
        legend="Open on launch"
        description="Where signing in and opening the workspace begins."
        value={preferences.launchPage}
        options={LAUNCH_OPTIONS}
        idPrefix="preferences-launch"
        columns="three"
        layout="stack"
      />

      <ChoiceGroup
        name="taskLayout"
        legend="Default task layout"
        description="Used when the Tasks view has no explicit layout in its address."
        value={preferences.taskLayout}
        options={LAYOUT_OPTIONS}
        idPrefix="preferences-layout"
        columns="two"
        layout="stack"
      />

      <ChoiceGroup
        name="taskOpenMode"
        legend="Open tasks in"
        description="Drawer controls still switch this for an individual selection."
        value={preferences.taskOpenMode}
        options={OPEN_MODE_OPTIONS}
        idPrefix="preferences-open-mode"
        columns="two"
        layout="stack"
      />

      <div>
        <PendingSubmitButton type="submit" pendingLabel="Saving…">
          Save workspace defaults
        </PendingSubmitButton>
      </div>
    </form>
  );
}
