import { DAYS, type PersonalOperations } from "@ega/domain/preferences";

import { PendingSubmitButton } from "@/components/ui/pending-submit-button";

import {
  getWeeklyTargetTotals,
  minutesToHoursValue,
} from "@/app/(workspace)/settings/_lib/work-targets";

const DAY_LABELS: Record<(typeof DAYS)[number], string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

function formatHours(minutes: number): string {
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

/**
 * Lean replacement for the retired weekly schedule editor.
 *
 * The owner sets a work and job-search target for each day, plus whether the
 * targets are paused. The form posts hours; the server action validates them,
 * stores whole minutes and carries the persisted guidance blocks through
 * unchanged. There are no schedule blocks, overlap checks or job-search task
 * picker here.
 */
export function WorkTargetsForm({
  personalOperations,
  action,
}: {
  personalOperations: PersonalOperations;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const targets = personalOperations.targets;
  const totals = getWeeklyTargetTotals(targets);

  return (
    <form action={action} aria-label="Work targets" className="flex flex-col gap-5">
      <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
        Today and reviews compare tracked time with these targets.
        Weekly totals update from the saved values.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-left">
          <caption className="sr-only">Daily work and job-search targets in hours</caption>
          <thead>
            <tr className="border-b border-[var(--ega-border)] text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
              <th scope="col" className="py-2 pr-3 font-medium">
                Day
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Work (hours)
              </th>
              <th scope="col" className="py-2 font-medium">
                Job search (hours)
              </th>
            </tr>
          </thead>
          <tbody>
            {DAYS.map((day) => (
              <tr key={day} className="border-b border-[var(--ega-divider)] last:border-b-0">
                <th scope="row" className="py-2 pr-3 text-[length:var(--text-body)] font-medium">
                  {DAY_LABELS[day]}
                </th>
                <td className="py-2 pr-3">
                  <label className="sr-only" htmlFor={`work-${day}`}>
                    {DAY_LABELS[day]} work target in hours
                  </label>
                  <input
                    id={`work-${day}`}
                    name={`work-${day}`}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max="24"
                    step="0.01"
                    required
                    defaultValue={minutesToHoursValue(targets[day].work)}
                    className="h-9 w-24 rounded-[var(--radius-sm)] border border-[var(--ega-border)] bg-[var(--ega-surface)] px-2 text-[length:var(--text-body)] tabular-nums"
                  />
                </td>
                <td className="py-2">
                  <label className="sr-only" htmlFor={`jobSearch-${day}`}>
                    {DAY_LABELS[day]} job-search target in hours
                  </label>
                  <input
                    id={`jobSearch-${day}`}
                    name={`jobSearch-${day}`}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max="24"
                    step="0.01"
                    required
                    defaultValue={minutesToHoursValue(targets[day].jobSearch)}
                    className="h-9 w-24 rounded-[var(--radius-sm)] border border-[var(--ega-border)] bg-[var(--ega-surface)] px-2 text-[length:var(--text-body)] tabular-nums"
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="text-[length:var(--text-body)] font-semibold">
              <th scope="row" className="py-3 pr-3 text-left">
                Weekly total
              </th>
              <td className="py-3 pr-3 tabular-nums">{formatHours(totals.work)}</td>
              <td className="py-3 tabular-nums">{formatHours(totals.jobSearch)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <label
        htmlFor="workTargetsPaused"
        className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--ega-border)] p-3"
      >
        <input
          id="workTargetsPaused"
          type="checkbox"
          name="paused"
          defaultChecked={personalOperations.paused}
          className="mt-0.5 h-4 w-4"
        />
        <span className="min-w-0">
          <span className="block text-[length:var(--text-body)] font-medium">Pause targets</span>
          <span className="mt-1 block text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            Keeps the values saved but stops them counting as active targets.
          </span>
        </span>
      </label>

      <div>
        <PendingSubmitButton type="submit" pendingLabel="Saving…">
          Save work targets
        </PendingSubmitButton>
      </div>
    </form>
  );
}
