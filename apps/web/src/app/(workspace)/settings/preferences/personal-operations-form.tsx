"use client";

import {
  startTransition,
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";

import {
  getPersonalOperationsDayPlan,
  type JobSearchReference,
} from "@ega/domain/preferences";
import { getLocalDateInTimezone, getLocalDayWindow } from "@ega/domain/time-context";

import { DailyTargets } from "./daily-targets";
import { BlockEditor } from "./block-editor";
import {
  clearScheduleDraft,
  createScheduleDraftKey,
  getSessionStorage,
  readScheduleDraft,
  writeScheduleDraft,
} from "./schedule-draft-storage";
import styles from "./preferences.module.css";
import {
  type Day,
  type PersonalOperationsTimeContext,
  type Schedule,
  getGuidanceConflicts,
  getTargetSeries,
  getWeeklyTotals,
  hasInvalidTargets,
  schedulesEqual,
} from "./schedule-model";
import { ScheduleCheck } from "./schedule-check";
import { SummaryStrip } from "./summary-strip";
import { WeeklyPlanner } from "./weekly-planner";

export type { PersonalOperationsTimeContext } from "./schedule-model";

export type PersonalOperationsActionState = { message: string; ok: boolean };
export type PersonalOperationsAction = (
  state: PersonalOperationsActionState,
  formData: FormData,
) => Promise<PersonalOperationsActionState>;

export type JobSearchReferenceOptions = {
  tasks: Array<{ id: string; title: string; archivedAt: string | null }>;
};

function referencesEqual(
  left: JobSearchReference | null,
  right: JobSearchReference | null,
): boolean {
  if (left === null || right === null) return left === right;
  return left.kind === right.kind && left.id === right.id;
}

const INITIAL_STATE: PersonalOperationsActionState = { message: "", ok: false };

function subscribeToMinute(onChange: () => void) {
  const interval = window.setInterval(onChange, 60_000);
  return () => window.clearInterval(interval);
}

function readMinute(): number {
  return Math.floor(Date.now() / 60_000);
}

/**
 * The current minute from an external clock rather than effect-synchronised
 * state. The server snapshot is null, so the "next guidance" copy never causes
 * a hydration mismatch; the client re-renders once after hydration and then
 * once per minute.
 */
function useMinuteNow(): Date | null {
  const minute = useSyncExternalStore(subscribeToMinute, readMinute, () => null);
  return minute === null ? null : new Date(minute * 60_000);
}

type TargetKey = "work" | "jobSearch";

export function PersonalOperationsForm({
  initial,
  initialReference = null,
  referenceOptions = { tasks: [] },
  disabled,
  timeContext = null,
  accountScope = null,
  action,
}: {
  initial: Schedule;
  initialReference?: JobSearchReference | null;
  referenceOptions?: JobSearchReferenceOptions;
  disabled: boolean;
  timeContext?: PersonalOperationsTimeContext | null;
  accountScope?: string | null;
  action: PersonalOperationsAction;
}) {
  const [draft, setDraft] = useState<Schedule>(initial);
  const [baseline, setBaseline] = useState<Schedule>(initial);
  const [reference, setReference] = useState<JobSearchReference | null>(initialReference);
  const [referenceBaseline, setReferenceBaseline] = useState<JobSearchReference | null>(initialReference);
  const [localDate, setLocalDate] = useState(timeContext?.localDate ?? null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [restoredNotice, setRestoredNotice] = useState(false);
  const restoredCheckedRef = useRef(false);
  const hadDirtyRef = useRef(false);
  const draftKey = useMemo(
    () => createScheduleDraftKey("/settings/preferences", initial, accountScope),
    [initial, accountScope],
  );
  const now = useMinuteNow();

  // Refresh the owner-local date at local midnight and whenever the tab
  // resumes, so the schedule day and today's plan do not drift from the
  // account Time Context. The server's localDate is the initial value.
  useEffect(() => {
    const timezone = timeContext?.timezone;
    if (!timezone) return;
    const zone = timezone;
    let timer: ReturnType<typeof setTimeout>;
    function refreshDate() {
      clearTimeout(timer);
      const current = new Date();
      const date = getLocalDateInTimezone(current, zone);
      setLocalDate(date);
      const end = getLocalDayWindow(zone, date).endUtcIso;
      timer = setTimeout(
        refreshDate,
        Math.max(1000, Date.parse(end) - current.getTime()),
      );
    }
    refreshDate();
    document.addEventListener("visibilitychange", refreshDate);
    window.addEventListener("focus", refreshDate);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", refreshDate);
      window.removeEventListener("focus", refreshDate);
    };
  }, [timeContext?.timezone]);

  const submit = useCallback(
    async (state: PersonalOperationsActionState, formData: FormData) => {
      try {
        return await action(state, formData);
      } catch {
        return {
          ok: false,
          message:
            "Unable to save the personal schedule right now. Your changes are still here.",
        } satisfies PersonalOperationsActionState;
      }
    },
    [action],
  );
  const [state, submitAction, pending] = useActionState(submit, INITIAL_STATE);
  const submittedRef = useRef<{ schedule: Schedule; reference: JobSearchReference | null } | null>(null);
  const [ignoredState, setIgnoredState] =
    useState<PersonalOperationsActionState | null>(null);
  const inFlightRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const focusEditorRef = useRef(false);
  const editorHeadingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLSpanElement>(null);
  const visibleState = ignoredState === state ? INITIAL_STATE : state;

  const scheduleDirty = !schedulesEqual(baseline, draft);
  const referenceDirty = !referencesEqual(referenceBaseline, reference);
  const dirty = scheduleDirty || referenceDirty;
  const referenceValue = reference ? `task:${reference.id}` : "";
  const referenceInOptions =
    reference === null
    || referenceOptions.tasks.some((task) => task.id === reference.id);
  function setReferenceValue(value: string) {
    if (!value) {
      setReference(null);
      return;
    }
    const separator = value.indexOf(":");
    const kind = value.slice(0, separator);
    const id = value.slice(separator + 1);
    if (kind !== "task" || !id) return;
    setReference({ kind: "task", id });
  }
  const conflicts = useMemo(
    () => getGuidanceConflicts(draft.guidance),
    [draft.guidance],
  );
  const invalidTargets = hasInvalidTargets(draft);
  const totals = getWeeklyTotals(draft);
  // Canonical day plan: the draft is the edited schedule, the date is already
  // resolved in the account Time Context.
  const today =
    timeContext && localDate
      ? getPersonalOperationsDayPlan(draft, localDate)
      : null;
  const blocked = invalidTargets || conflicts.messages.length > 0;
  const canSave = !disabled && !blocked;

  const selected = draft.guidance[selectedIndex] ?? draft.guidance[0];
  const resolvedSelectedIndex = selected
    ? draft.guidance.indexOf(selected)
    : -1;
  const selectedConflicts = selected
    ? conflicts.messages.filter((message) => message.includes(selected.name))
    : [];

  useEffect(() => {
    inFlightRef.current = false;
    if (!state.message || submittedRef.current === null) return;
    const submitted = submittedRef.current;
    submittedRef.current = null;
    if (state.ok) {
      setBaseline(submitted.schedule);
      setReferenceBaseline(submitted.reference);
      setRestoredNotice(false);
      clearScheduleDraft(getSessionStorage(), draftKey);
      hadDirtyRef.current = false;
      formRef.current?.focus({ preventScroll: true });
      return;
    }
    errorRef.current?.focus();
  }, [state, draftKey]);

  // Restore a preserved draft after an App Router Back/Forward remount. The
  // key contains the loaded baseline fingerprint, so a different account or
  // stored schedule cannot inherit this draft.
  useEffect(() => {
    if (disabled || restoredCheckedRef.current) return;
    restoredCheckedRef.current = true;
    const storage = getSessionStorage();
    const restored = readScheduleDraft(storage, draftKey);
    if (!restored) return;
    if (schedulesEqual(restored, initial)) {
      clearScheduleDraft(storage, draftKey);
      return;
    }
    // A transition is safe under StrictMode's double-invoked effects:
    // `restoredCheckedRef` lets only the first invocation schedule the restore,
    // and there is no timer cleanup that could cancel the surviving update.
    startTransition(() => {
      setDraft(restored);
      setRestoredNotice(true);
    });
  }, [disabled, draftKey, initial]);

  // Keep the snapshot in sync with the editable draft. A first mount with no
  // edits must not clear a snapshot before the restore effect has read it.
  useEffect(() => {
    const storage = getSessionStorage();
    if (dirty) {
      writeScheduleDraft(storage, draftKey, draft);
      hadDirtyRef.current = true;
      return;
    }
    if (hadDirtyRef.current) {
      clearScheduleDraft(storage, draftKey);
      hadDirtyRef.current = false;
    }
  }, [draft, dirty, draftKey]);

  // A real tab close/navigation must not leave a draft for a later account.
  useEffect(() => {
    const storage = getSessionStorage();
    const onPageHide = () => clearScheduleDraft(storage, draftKey);
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [draftKey]);

  useEffect(() => {
    if (!focusEditorRef.current) return;
    focusEditorRef.current = false;
    const heading = editorHeadingRef.current;
    if (!heading) return;
    heading.focus({ preventScroll: true });
    heading.scrollIntoView?.({ block: "nearest" });
  }, [resolvedSelectedIndex]);

  // A draft that only exists in memory must not disappear without a warning.
  useEffect(() => {
    if (!dirty || disabled) return;

    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    const warnBeforeLeaving = (message: string) => window.confirm(message);

    const onClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute("download") || anchor.getAttribute("target") === "_blank") {
        return;
      }
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      // The active Settings link (and any same-path anchor) does not leave the
      // page. Never prompt for it or clear a draft that stays restorable.
      try {
        const destination = new URL(anchor.href);
        // mailto:/tel: and other non-document schemes do not remount this page.
        if (destination.protocol !== "http:" && destination.protocol !== "https:") {
          return;
        }
        if (destination.origin === window.location.origin && destination.pathname === window.location.pathname) return;
      } catch {
        return;
      }
      const confirmed = warnBeforeLeaving(
        "You have unsaved schedule changes. Leave this page and discard them?",
      );
      if (!confirmed) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      clearScheduleDraft(getSessionStorage(), draftKey);
      hadDirtyRef.current = false;
    };

    const onSubmit = (event: SubmitEvent) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (form.dataset.personalOperationsForm === "true") return;
      const confirmed = warnBeforeLeaving(
        "You have unsaved schedule changes. Continue with this submission? The schedule draft will be kept while you stay on this page, but leaving or reloading may discard it.",
      );
      if (!confirmed) {
        event.preventDefault();
        event.stopPropagation();
      }
      // Deliberately do not clear the snapshot here. This form may stay mounted
      // (for example Workspace defaults) or navigate. A full navigation or
      // reload clears the snapshot via the pagehide handler.
    };

    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
    };
  }, [dirty, disabled, draftKey]);

  function selectGuidance(index: number) {
    if (index === resolvedSelectedIndex) {
      const heading = editorHeadingRef.current;
      heading?.focus({ preventScroll: true });
      heading?.scrollIntoView?.({ block: "nearest" });
      return;
    }
    focusEditorRef.current = true;
    setSelectedIndex(index);
  }

  function updateGuidance(index: number, patch: Partial<Schedule["guidance"][number]>) {
    setDraft((current) => ({
      ...current,
      guidance: current.guidance.map((block, blockIndex) =>
        blockIndex === index ? { ...block, ...patch } : block,
      ),
    }));
  }

  function updateTarget(day: Day, field: TargetKey, rawValue: string) {
    const parsed =
      rawValue.trim() === "" ? -1 : Math.trunc(Number(rawValue));
    const value = Number.isFinite(parsed) ? parsed : -1;
    setDraft((current) => ({
      ...current,
      targets: {
        ...current.targets,
        [day]: { ...current.targets[day], [field]: value },
      },
    }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (pending || inFlightRef.current || !canSave) {
      event.preventDefault();
      return;
    }
    inFlightRef.current = true;
    setIgnoredState(null);
    submittedRef.current = { schedule: draft, reference };
  }

  let status = "All schedule changes saved.";
  let statusIsError = false;
  if (pending) {
    status = "Saving personal schedule…";
  } else if (visibleState.message && !visibleState.ok) {
    status = visibleState.message;
    statusIsError = true;
  } else if (dirty) {
    status = restoredNotice
      ? "Unsaved changes restored. Review and save, or discard."
      : blocked
        ? "Fix the highlighted schedule problems before saving."
        : "Unsaved changes";
  } else if (visibleState.ok && visibleState.message) {
    status = visibleState.message;
  }

  const showBar = dirty || pending || Boolean(visibleState.message);
  const announcement = pending
    ? "Saving personal schedule…"
    : visibleState.ok && visibleState.message && !dirty
      ? visibleState.message
      : restoredNotice && dirty
        ? "Unsaved changes restored. Review and save, or discard."
        : "";

  return (
    <form
      ref={formRef}
      action={submitAction}
      className={styles.formShim}
      data-personal-operations-form="true"
      onSubmit={handleSubmit}
      aria-label="Personal schedule"
      tabIndex={-1}
    >
      <input type="hidden" name="schedule" value={JSON.stringify(draft)} />
      <input type="hidden" name="jobSearchReferenceDirty" value={referenceDirty ? "true" : "false"} />
      <fieldset
        disabled={disabled || pending}
        className={styles.formShim}
        style={{ border: 0, padding: 0, margin: 0 }}
      >
        {disabled ? (
          <p className={styles.disabledNote}>
            Read-only until your preferences load. Nothing here can overwrite the
            stored schedule.
          </p>
        ) : null}

        <SummaryStrip
          schedule={draft}
          onPauseChange={(paused) =>
            setDraft((current) => ({ ...current, paused }))
          }
        />

        <div className={styles.layout}>
          <div className={styles.mainColumn}>
            <WeeklyPlanner
              guidance={draft.guidance}
              targets={getTargetSeries(draft, "work")}
              conflicts={conflicts}
              selectedIndex={resolvedSelectedIndex}
              paused={draft.paused}
              onSelect={selectGuidance}
            />

            {selected ? (
              <BlockEditor
                block={selected}
                index={resolvedSelectedIndex}
                conflictMessages={selectedConflicts}
                headingRef={editorHeadingRef}
                onChange={(patch) => updateGuidance(resolvedSelectedIndex, patch)}
              />
            ) : (
              <section className={styles.panel}>
                <div className={styles.panelBody}>
                  <p className={styles.panelDescription}>
                    No guidance blocks are stored on this account.
                  </p>
                </div>
              </section>
            )}

            <DailyTargets targets={draft.targets} onTargetChange={updateTarget} />

            <section className={styles.panel} aria-label="Job-search work reference">
              <div className={styles.panelBody}>
                <label className={styles.fieldLabel} htmlFor="job-search-reference">
                  Job-search work reference
                </label>
                <select
                  id="job-search-reference"
                  name="jobSearchReference"
                  value={referenceValue}
                  onChange={(event) => setReferenceValue(event.target.value)}
                >
                  <option value="">No job-search task</option>
                  {referenceOptions.tasks.length > 0 ? (
                    <optgroup label="Tasks">
                      {referenceOptions.tasks.map((task) => (
                        <option key={task.id} value={`task:${task.id}`}>
                          {task.title}
                          {task.archivedAt ? " (archived)" : ""}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  {!referenceInOptions && reference ? (
                    <optgroup label="Current selection">
                      <option value={`task:${reference.id}`}>
                        Task {reference.id} (not in the current list)
                      </option>
                    </optgroup>
                  ) : null}
                </select>
                <p className={styles.panelDescription}>
                  Job-search time is classified by this exact task id, never by
                  title, and stays inside your work total. Changing the task
                  reclassifies historical totals.
                </p>
              </div>
            </section>
          </div>

          <ScheduleCheck
            schedule={draft}
            conflicts={conflicts}
            timeContext={timeContext}
            today={today}
            now={now}
          />
        </div>
      </fieldset>

      <div className={styles.srOnly} role="status" aria-live="polite">
        {announcement}
      </div>

      {showBar ? (
        <div
          className={styles.saveBar}
          role="region"
          aria-label="Schedule save status"
        >
          <span
            ref={errorRef}
            tabIndex={statusIsError ? -1 : undefined}
            role={statusIsError ? "alert" : undefined}
            className={`${styles.saveBarStatus} ${statusIsError ? styles.saveBarError : ""}`}
          >
            {status}
            {!statusIsError && dirty
              ? ` · ${totals.work.toLocaleString("en-US")} work min / ${totals.jobSearch.toLocaleString("en-US")} search min`
              : null}
          </span>
          <div className={styles.saveBarActions}>
            <button
              type="button"
              className={styles.saveBarButton}
              disabled={pending}
              onClick={() => {
                setIgnoredState(state);
                setDraft(baseline);
                setReference(referenceBaseline);
                setRestoredNotice(false);
                clearScheduleDraft(getSessionStorage(), draftKey);
                hadDirtyRef.current = false;
                setSelectedIndex((current) =>
                  Math.max(0, Math.min(current, baseline.guidance.length - 1)),
                );
                formRef.current?.focus({ preventScroll: true });
              }}
            >
              Discard
            </button>
            <button
              type="submit"
              className={`${styles.saveBarButton} ${styles.saveBarPrimary}`}
              disabled={!canSave || !dirty || pending}
            >
              {pending ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      ) : null}
    </form>
  );
}
