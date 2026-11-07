import type { UserPreferences } from "@ega/domain/preferences";

import { ChoiceGroup } from "@/app/(workspace)/settings/_components/choice-group";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";

import styles from "./preferences.module.css";

type WorkspaceDefaults = Pick<
  UserPreferences,
  "launchPage" | "taskLayout" | "taskOpenMode"
>;

function LaunchPreview({ selected }: { selected: WorkspaceDefaults["launchPage"] }) {
  const rows: WorkspaceDefaults["launchPage"][] = ["home", "today", "tasks"];
  return (
    <span className={styles.miniPreview} aria-hidden="true">
      <span className={styles.miniPreviewRows}>
        {rows.map((row) => (
          <span
            key={row}
            className={`${styles.miniPreviewRow} ${row === selected ? styles.miniPreviewRowActive : ""}`}
          />
        ))}
      </span>
    </span>
  );
}

function LayoutPreview({ selected }: { selected: WorkspaceDefaults["taskLayout"] }) {
  if (selected === "kanban") {
    return (
      <span className={styles.miniPreview} aria-hidden="true">
        <span className={styles.miniPreviewColumns}>
          <span className={styles.miniPreviewColumn} />
          <span className={`${styles.miniPreviewColumn} ${styles.miniPreviewColumnActive}`} />
          <span className={styles.miniPreviewColumn} />
        </span>
      </span>
    );
  }

  return (
    <span className={styles.miniPreview} aria-hidden="true">
      <span className={styles.miniPreviewRows}>
        <span className={styles.miniPreviewRow} />
        <span className={`${styles.miniPreviewRow} ${styles.miniPreviewRowActive}`} />
        <span className={styles.miniPreviewRow} />
      </span>
    </span>
  );
}

function OpenModePreview({ selected }: { selected: WorkspaceDefaults["taskOpenMode"] }) {
  return (
    <span className={styles.miniPreview} aria-hidden="true">
      {selected === "panel" ? (
        <span className={styles.miniPreviewSplit}>
          <span className={styles.miniPreviewMain} />
          <span className={styles.miniPreviewAside} />
        </span>
      ) : (
        <span className={styles.miniPreviewFull} />
      )}
    </span>
  );
}

const LAUNCH_OPTIONS = [
  {
    value: "home",
    label: "Home",
    description: "Overview and current focus.",
    preview: <LaunchPreview selected="home" />,
  },
  {
    value: "today",
    label: "Today",
    description: "The daily execution plan.",
    preview: <LaunchPreview selected="today" />,
  },
  {
    value: "tasks",
    label: "Tasks",
    description: "The full work inventory.",
    preview: <LaunchPreview selected="tasks" />,
  },
] as const;

const LAYOUT_OPTIONS = [
  {
    value: "list",
    label: "List",
    description: "Dense, sortable rows.",
    preview: <LayoutPreview selected="list" />,
  },
  {
    value: "kanban",
    label: "Kanban",
    description: "Status columns you can scan across.",
    preview: <LayoutPreview selected="kanban" />,
  },
] as const;

const OPEN_MODE_OPTIONS = [
  {
    value: "panel",
    label: "Side panel",
    description: "Keeps the current list in view.",
    preview: <OpenModePreview selected="panel" />,
  },
  {
    value: "full",
    label: "Full page",
    description: "Gives task detail the whole surface.",
    preview: <OpenModePreview selected="full" />,
  },
] as const;

/**
 * Workspace defaults keep their own server action and save button. They are
 * intentionally not part of the schedule draft: saving one never writes the
 * other preference section.
 */
export function WorkspaceDefaultsForm({
  preferences,
  action,
}: {
  preferences: WorkspaceDefaults;
  action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <section className={styles.panel} aria-labelledby="workspace-defaults-title">
      <div className={styles.panelHeader}>
        <div>
          <h2 id="workspace-defaults-title" className={styles.panelTitle}>
            Workspace defaults
          </h2>
          <p className={styles.panelDescription}>
            Stored on your account. Controls on a page itself still win for the
            current view.
          </p>
        </div>
      </div>

      <div className={styles.panelBody}>
        <form action={action} className={styles.workspaceForm}>
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

          <div className={styles.workspaceActions}>
            <p className={styles.workspaceNote}>
              These choices are saved separately from the personal schedule.
            </p>
            <PendingSubmitButton type="submit" pendingLabel="Saving…">
              Save preferences
            </PendingSubmitButton>
          </div>
        </form>
      </div>
    </section>
  );
}
