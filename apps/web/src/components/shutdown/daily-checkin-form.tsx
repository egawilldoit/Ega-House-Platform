"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { Textarea } from "@/components/ui/textarea";
import type { DailyCheckin } from "@ega/domain/checkins";

type DailyCheckinFormProps = {
  checkin: DailyCheckin | null;
  defaultLocalDate: string;
  action: (formData: FormData) => Promise<void>;
  returnTo: string;
};

/**
 * Two-minute evening check-in (PO-05, issue #345). Only concise qualitative
 * outcomes are stored; completed tasks and timer totals are derived on the
 * page from their canonical sources and never copied into this record.
 */
export function DailyCheckinForm({
  checkin,
  defaultLocalDate,
  action,
  returnTo,
}: DailyCheckinFormProps) {
  const [localDate, setLocalDate] = useState(checkin?.localDate ?? defaultLocalDate);
  const [outcomes, setOutcomes] = useState(checkin?.outcomes ?? "");
  const [personalMinutes, setPersonalMinutes] = useState(
    checkin?.personalMinutes == null ? "" : String(checkin.personalMinutes),
  );
  const [notes, setNotes] = useState(checkin?.notes ?? "");
  const [overtimeMinutes, setOvertimeMinutes] = useState(
    checkin?.overtimeMinutes == null ? "" : String(checkin.overtimeMinutes),
  );
  const [overtimeReason, setOvertimeReason] = useState(checkin?.overtimeReason ?? "");
  const routine = checkin?.routine ?? null;
  const [runMinutes, setRunMinutes] = useState(routine?.runMinutes == null ? "" : String(routine.runMinutes));
  const [chessMinutes, setChessMinutes] = useState(routine?.chessMinutes == null ? "" : String(routine.chessMinutes));
  const [sleepHours, setSleepHours] = useState(routine?.sleepHours == null ? "" : String(routine.sleepHours));
  const [leisureMinutes, setLeisureMinutes] = useState(routine?.leisureMinutes == null ? "" : String(routine.leisureMinutes));
  const [runDone, setRunDone] = useState<boolean | null>(routine?.runCompleted ?? null);
  const [runSkipped, setRunSkipped] = useState<boolean | null>(routine?.runSkipped ?? null);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="returnTo" value={returnTo} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="checkin-date" className="form-label">
          Day
        </label>
        <Input
          id="checkin-date"
          name="localDate"
          type="date"
          required
          value={localDate}
          onChange={(event) => setLocalDate(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="checkin-outcomes" className="form-label">
          What closed out today?
        </label>
        <Textarea
          id="checkin-outcomes"
          name="outcomes"
          value={outcomes}
          onChange={(event) => setOutcomes(event.target.value)}
          maxLength={500}
          placeholder="One or two lines. Tasks and timers are counted automatically."
          className="min-h-[64px]"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="checkin-personal-minutes" className="form-label">
          Personal time (minutes, optional)
        </label>
        <Input
          id="checkin-personal-minutes"
          name="personalMinutes"
          type="number"
          inputMode="numeric"
          min={0}
          max={1440}
          step={1}
          value={personalMinutes}
          onChange={(event) => setPersonalMinutes(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="checkin-notes" className="form-label">
          Notes (optional)
        </label>
        <Textarea
          id="checkin-notes"
          name="notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          maxLength={1000}
          className="min-h-[56px]"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="checkin-overtime-minutes" className="form-label">
            Overtime (minutes)
          </label>
          <Input
            id="checkin-overtime-minutes"
            name="overtimeMinutes"
            type="number"
            inputMode="numeric"
            min={0}
            max={1440}
            step={1}
            value={overtimeMinutes}
            onChange={(event) => setOvertimeMinutes(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="checkin-overtime-reason" className="form-label">
            Overtime reason
          </label>
          <Input
            id="checkin-overtime-reason"
            name="overtimeReason"
            type="text"
            maxLength={300}
            value={overtimeReason}
            onChange={(event) => setOvertimeReason(event.target.value)}
          />
        </div>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="form-label">Routine (optional)</legend>
        <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
          Leave a field blank for unknown. Blank is not zero, and a run never adds to work hours.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="checkin-run-minutes" className="form-label">
              Run (minutes)
            </label>
            <Input
              id="checkin-run-minutes"
              name="routine.runMinutes"
              data-routine-field="runMinutes"
              type="number"
              inputMode="numeric"
              min={0}
              max={1440}
              step={1}
              value={runMinutes}
              onChange={(event) => setRunMinutes(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="checkin-chess-minutes" className="form-label">
              Chess (minutes)
            </label>
            <Input
              id="checkin-chess-minutes"
              name="routine.chessMinutes"
              data-routine-field="chessMinutes"
              type="number"
              inputMode="numeric"
              min={0}
              max={1440}
              step={1}
              value={chessMinutes}
              onChange={(event) => setChessMinutes(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="checkin-sleep-hours" className="form-label">
              Sleep (hours)
            </label>
            <Input
              id="checkin-sleep-hours"
              name="routine.sleepHours"
              data-routine-field="sleepHours"
              type="number"
              inputMode="decimal"
              min={0}
              max={24}
              step={0.5}
              value={sleepHours}
              onChange={(event) => setSleepHours(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="checkin-leisure-minutes" className="form-label">
              Leisure (minutes)
            </label>
            <Input
              id="checkin-leisure-minutes"
              name="routine.leisureMinutes"
              data-routine-field="leisureMinutes"
              type="number"
              inputMode="numeric"
              min={0}
              max={1440}
              step={1}
              value={leisureMinutes}
              onChange={(event) => setLeisureMinutes(event.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <label className="inline-flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              name="routine.runCompleted"
              data-routine-field="runCompleted"
              aria-label="Run completed"
              checked={runDone === true}
              onChange={(event) => {
                setRunDone(event.target.checked);
                if (event.target.checked) setRunSkipped(false);
              }}
            />
            Run completed
          </label>
          <label className="inline-flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              name="routine.runSkipped"
              data-routine-field="runSkipped"
              aria-label="Run skipped"
              checked={runSkipped === true}
              onChange={(event) => {
                setRunSkipped(event.target.checked);
                if (event.target.checked) setRunDone(false);
              }}
            />
            Run skipped
          </label>
        </div>
      </fieldset>

      {checkin ? (
        <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
          Saved check-in loaded. Saving updates this one record for the day.
        </p>
      ) : null}

      <div>
        <PendingSubmitButton pendingLabel="Saving…">Save check-in</PendingSubmitButton>
      </div>
    </form>
  );
}
