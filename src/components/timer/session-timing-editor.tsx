"use client";

import { useMemo, useRef, useState } from "react";

import { formatDurationLabel } from "@/lib/task-session";
import {
  getTimerCorrectionPreview,
  shiftLocalTimeValue,
  toLocalDateInputValue,
  toLocalTimeInputValue,
} from "@/lib/timer-correction";

import { Button } from "../ui/button";

type SessionTimingEditorProps = {
  sessionId: string;
  startedAt: string;
  endedAt: string;
  returnTo: string;
  action: (formData: FormData) => void | Promise<void>;
};

export function SessionTimingEditor({
  sessionId,
  startedAt,
  endedAt,
  returnTo,
  action,
}: SessionTimingEditorProps) {
  const initialDate = toLocalDateInputValue(startedAt);
  const initialStartTime = toLocalTimeInputValue(startedAt);
  const initialEndTime = toLocalTimeInputValue(endedAt);

  const [dateValue, setDateValue] = useState(initialDate);
  const [startTimeValue, setStartTimeValue] = useState(initialStartTime);
  const [endTimeValue, setEndTimeValue] = useState(initialEndTime);
  const formRef = useRef<HTMLFormElement | null>(null);

  const preview = useMemo(
    () =>
      getTimerCorrectionPreview({
        date: dateValue,
        startTime: startTimeValue,
        endTime: endTimeValue,
      }),
    [dateValue, startTimeValue, endTimeValue],
  );

  const canSave = preview.errorMessage === null && preview.data !== null;

  function resetAndClose() {
    setDateValue(initialDate);
    setStartTimeValue(initialStartTime);
    setEndTimeValue(initialEndTime);

    const details = formRef.current?.closest("details");
    if (details) {
      details.removeAttribute("open");
    }
  }

  function nudgeEndTime(deltaMinutes: number) {
    setEndTimeValue((currentValue) => shiftLocalTimeValue(currentValue, deltaMinutes));
  }

  return (
    <form ref={formRef} action={action} className="mt-3 space-y-3">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <label htmlFor={`session-date-${sessionId}`} className="glass-label text-etch">
            Date
          </label>
          <input
            id={`session-date-${sessionId}`}
            name="date"
            type="date"
            required
            value={dateValue}
            onChange={(event) => setDateValue(event.target.value)}
            className="input-instrument mt-2 h-9 w-full text-sm"
          />
        </div>
        <div>
          <label htmlFor={`session-start-${sessionId}`} className="glass-label text-etch">
            Start time
          </label>
          <input
            id={`session-start-${sessionId}`}
            name="startTime"
            type="time"
            required
            value={startTimeValue}
            onChange={(event) => setStartTimeValue(event.target.value)}
            className="input-instrument mt-2 h-9 w-full text-sm"
          />
        </div>
        <div>
          <label htmlFor={`session-end-${sessionId}`} className="glass-label text-etch">
            End time
          </label>
          <input
            id={`session-end-${sessionId}`}
            name="endTime"
            type="time"
            required
            value={endTimeValue}
            onChange={(event) => setEndTimeValue(event.target.value)}
            className="input-instrument mt-2 h-9 w-full text-sm"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {[-30, -15, 15, 30].map((offset) => (
              <button
                key={offset}
                type="button"
                onClick={() => nudgeEndTime(offset)}
                className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[11px] font-medium text-[color:var(--muted-foreground)] transition hover:bg-[color:var(--instrument-raised)] hover:text-[color:var(--foreground)]"
              >
                {offset > 0 ? `+${offset}` : offset}m
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-[0.75rem] border border-[var(--border)] bg-white/80 px-3 py-2">
        {preview.data ? (
          <p className="text-sm text-[color:var(--foreground)]">
            <span className="glass-label text-etch">Duration</span>{" "}
            <span className="font-medium text-[var(--signal-live)]">
              {formatDurationLabel(preview.data.durationSeconds)}
            </span>
          </p>
        ) : (
          <p className="text-sm text-[var(--signal-error)]">{preview.errorMessage}</p>
        )}
      </div>

      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <input type="hidden" name="startedAt" value={preview.data?.startedAtIso ?? ""} />
      <input type="hidden" name="endedAt" value={preview.data?.endedAtIso ?? ""} />

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="muted" size="sm" onClick={resetAndClose}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!canSave}>
          Save changes
        </Button>
      </div>
    </form>
  );
}
