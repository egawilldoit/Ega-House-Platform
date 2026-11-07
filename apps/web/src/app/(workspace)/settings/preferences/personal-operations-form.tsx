"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import {
  DAYS,
  getPersonalOperationsDayPlan,
  getPersonalOperationsWeekTotals,
  type Day,
  type PersonalOperations,
} from "@ega/domain/preferences";
import { getLocalDateInTimezone, getLocalDayWindow } from "@ega/domain/time-context";

import { updatePersonalOperationsAction } from "./actions";

export type PersonalOperationsActionResult = {
  message: string;
  ok: boolean;
};

export type PersonalOperationsAction = (
  state: PersonalOperationsActionResult,
  formData: FormData,
) => Promise<PersonalOperationsActionResult>;

export type PersonalOperationsTimeContext = Readonly<{
  timezone: string;
  fallback: "none" | "missing_timezone" | "invalid_timezone";
  localDate: string;
}>;

/** Whole hours and minutes, e.g. 2880 -> "48 h", 450 -> "7 h 30 min". */
function formatDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function PersonalOperationsForm({
  initial,
  disabled,
  timeContext = null,
  action = updatePersonalOperationsAction,
}: {
  initial: PersonalOperations;
  disabled: boolean;
  timeContext?: PersonalOperationsTimeContext | null;
  action?: PersonalOperationsAction;
}) {
  const [schedule, setSchedule] = useState(initial);
  const [localDate, setLocalDate] = useState(timeContext?.localDate ?? null);
  const [state, formAction, pending] = useActionState(action, { message: "", ok: false });
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (state.message && !state.ok) errorRef.current?.focus();
  }, [state]);

  const timezone = timeContext?.timezone;
  useEffect(() => {
    if (!timezone) return;
    const zone = timezone;
    let timer: ReturnType<typeof setTimeout>;
    function refreshDate() {
      clearTimeout(timer);
      const now = new Date();
      const date = getLocalDateInTimezone(now, zone);
      setLocalDate(date);
      const end = getLocalDayWindow(zone, date).endUtcIso;
      timer = setTimeout(refreshDate, Math.max(1000, Date.parse(end) - now.getTime()));
    }
    refreshDate();
    document.addEventListener("visibilitychange", refreshDate);
    window.addEventListener("focus", refreshDate);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", refreshDate);
      window.removeEventListener("focus", refreshDate);
    };
  }, [timezone]);

  // Both views derive from the edited draft, so typing immediately updates
  // today's plan and the weekly totals.
  const totals = getPersonalOperationsWeekTotals(schedule);
  const today = timeContext && localDate
    ? getPersonalOperationsDayPlan(schedule, localDate)
    : null;

  function target(day: Day, field: "work" | "jobSearch", value: string) {
    setSchedule((current) => ({
      ...current,
      targets: {
        ...current.targets,
        [day]: {
          ...current.targets[day],
          [field]: value === "" ? -1 : Number(value),
        },
      },
    }));
  }

  function block(index: number, change: Partial<PersonalOperations["guidance"][number]>) {
    setSchedule((current) => ({
      ...current,
      guidance: current.guidance.map((item, i) =>
        i === index ? { ...item, ...change } : item,
      ),
    }));
  }

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <fieldset disabled={disabled || pending} className="flex flex-col gap-5">
        <input type="hidden" name="schedule" value={JSON.stringify(schedule)} />
        {disabled ? (
          <p className="feedback-block">
            Read-only until your preferences load. Nothing here can overwrite the
            stored schedule.
          </p>
        ) : null}

        {timeContext === null ? (
          <p>
            The account time zone is unavailable, so today&apos;s plan cannot be
            shown. The schedule below can still be edited and saved.
          </p>
        ) : today === null ? null : !today.ok ? (
          <p role="alert" className="feedback-block feedback-block-error">
            {today.message}
          </p>
        ) : (
          <section aria-label="Today's plan" className="flex flex-col gap-2">
            <p>
              Today in {timeContext.timezone}:{" "}
              <strong>{capitalize(today.value.day)}</strong> — {today.value.target.work}{" "}
              min work, {today.value.target.jobSearch} min job search
              {today.value.paused ? " (paused)" : ""}
            </p>
            {today.value.guidance.length > 0 ? (
              <ul aria-label="Today's guidance">
                {today.value.guidance.map((guidance, index) => (
                  <li key={`${guidance.name}-${guidance.start}-${index}`}>
                    {guidance.name}: {guidance.start}–{guidance.end}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No guidance blocks are enabled for today.</p>
            )}
          </section>
        )}

        <label>
          <input
            type="checkbox"
            checked={schedule.paused}
            onChange={(event) =>
              setSchedule((current) => ({ ...current, paused: event.target.checked }))
            }
          />{" "}
          Pause schedule
        </label>
        <p>
          {schedule.paused
            ? "Paused. Your targets are retained."
            : "Schedule active."}{" "}
          Weekly totals: {formatDuration(totals.work)} work /{" "}
          {formatDuration(totals.jobSearch)} job search. Raw minutes: {totals.work}{" "}
          work, {totals.jobSearch} job search.
        </p>

        <div className="grid gap-3">
          {DAYS.map((day) => (
            <fieldset key={day} className="flex flex-wrap gap-3">
              <legend className="capitalize">{day}</legend>
              <label>
                Work minutes{" "}
                <input
                  className="w-24"
                  type="number"
                  min="0"
                  max="1440"
                  required
                  value={schedule.targets[day].work < 0 ? "" : schedule.targets[day].work}
                  onChange={(event) => target(day, "work", event.target.value)}
                />
              </label>
              <label>
                Job-search minutes{" "}
                <input
                  className="w-24"
                  type="number"
                  min="0"
                  max="1440"
                  required
                  value={
                    schedule.targets[day].jobSearch < 0
                      ? ""
                      : schedule.targets[day].jobSearch
                  }
                  onChange={(event) => target(day, "jobSearch", event.target.value)}
                />
              </label>
            </fieldset>
          ))}
        </div>

        <p>
          Guidance is optional and does not create timers or notifications. Enabled
          blocks cannot overlap on the same day.
        </p>
        {schedule.guidance.map((item, index) => (
          <fieldset key={`${item.name}-${index}`} className="flex flex-wrap gap-3">
            <legend>{item.name}</legend>
            <label>
              <input
                type="checkbox"
                checked={item.enabled}
                onChange={(event) => block(index, { enabled: event.target.checked })}
              />{" "}
              Enabled
            </label>
            <label>
              Start{" "}
              <input
                type="time"
                required
                value={item.start}
                onChange={(event) => block(index, { start: event.target.value })}
              />
            </label>
            <label>
              End{" "}
              <input
                type="time"
                required
                value={item.end}
                onChange={(event) => block(index, { end: event.target.value })}
              />
            </label>
            <div>
              {DAYS.map((day) => (
                <label key={day} className="mr-2">
                  <input
                    type="checkbox"
                    checked={item.days.includes(day)}
                    onChange={(event) =>
                      block(index, {
                        days: event.target.checked
                          ? [...item.days, day]
                          : item.days.filter((value) => value !== day),
                      })
                    }
                  />{" "}
                  {day.slice(0, 3)}
                </label>
              ))}
            </div>
          </fieldset>
        ))}

        {state.message && (
          <p
            ref={errorRef}
            tabIndex={-1}
            role={state.ok ? "status" : "alert"}
          >
            {state.message}
          </p>
        )}
        <button type="submit">
          {pending ? "Saving..." : "Save personal schedule"}
        </button>
      </fieldset>
    </form>
  );
}
