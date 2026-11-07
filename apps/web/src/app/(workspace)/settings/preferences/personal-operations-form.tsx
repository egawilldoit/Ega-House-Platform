"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";

import { DailyTargets } from "./daily-targets";
import { BlockEditor } from "./block-editor";
import styles from "./preferences.module.css";
import {
  type Day,
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

export type PersonalOperationsActionState = { message: string; ok: boolean };
export type PersonalOperationsAction = (
  state: PersonalOperationsActionState,
  formData: FormData,
) => Promise<PersonalOperationsActionState>;

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
  disabled,
  timezone,
  action,
}: {
  initial: Schedule;
  disabled: boolean;
  timezone: string | null;
  action: PersonalOperationsAction;
}) {
  const [draft, setDraft] = useState<Schedule>(initial);
  const [baseline, setBaseline] = useState<Schedule>(initial);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const now = useMinuteNow();
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
  const submittedRef = useRef<Schedule | null>(null);
  const errorRef = useRef<HTMLSpanElement>(null);

  const dirty = !schedulesEqual(baseline, draft);
  const conflicts = useMemo(
    () => getGuidanceConflicts(draft.guidance),
    [draft.guidance],
  );
  const invalidTargets = hasInvalidTargets(draft);
  const totals = getWeeklyTotals(draft);
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
    if (!state.message || submittedRef.current === null) return;
    const submitted = submittedRef.current;
    submittedRef.current = null;
    if (state.ok) {
      setBaseline(submitted);
      return;
    }
    errorRef.current?.focus();
  }, [state]);

  // A draft that only exists in memory must not disappear without a warning.
  useEffect(() => {
    if (!dirty || disabled) return;

    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    const warnBeforeLeaving = () =>
      window.confirm(
        "You have unsaved schedule changes. Leave this page and discard them?",
      );

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
      if (!anchor || anchor.hasAttribute("download") || anchor.getAttribute("target") === "_blank") {
        return;
      }
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      if (!warnBeforeLeaving()) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    const onSubmit = (event: SubmitEvent) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (form.dataset.personalOperationsForm === "true") return;
      if (!warnBeforeLeaving()) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
    };
  }, [dirty, disabled]);

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
    if (pending || !canSave) {
      event.preventDefault();
      return;
    }
    submittedRef.current = draft;
  }

  let status = "All schedule changes saved.";
  let statusIsError = false;
  if (pending) {
    status = "Saving personal schedule…";
  } else if (state.message && !state.ok) {
    status = state.message;
    statusIsError = true;
  } else if (dirty) {
    status = blocked
      ? "Fix the highlighted schedule problems before saving."
      : "Unsaved changes";
  } else if (state.ok && state.message) {
    status = state.message;
  }

  const showBar = dirty || pending || Boolean(state.message);

  return (
    <form
      action={submitAction}
      className={styles.formShim}
      data-personal-operations-form="true"
      onSubmit={handleSubmit}
      aria-label="Personal schedule"
    >
      <input type="hidden" name="schedule" value={JSON.stringify(draft)} />
      <fieldset
        disabled={disabled || pending}
        className={styles.formShim}
        style={{ border: 0, padding: 0, margin: 0 }}
      >
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
              onSelect={setSelectedIndex}
            />

            {selected ? (
              <BlockEditor
                block={selected}
                index={resolvedSelectedIndex}
                conflictMessages={selectedConflicts}
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
          </div>

          <ScheduleCheck
            schedule={draft}
            conflicts={conflicts}
            timezone={timezone}
            now={now}
          />
        </div>
      </fieldset>

      {showBar ? (
        <div className={styles.saveBar} aria-live="polite">
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
                setDraft(baseline);
                setSelectedIndex((current) =>
                  Math.max(0, Math.min(current, baseline.guidance.length - 1)),
                );
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
