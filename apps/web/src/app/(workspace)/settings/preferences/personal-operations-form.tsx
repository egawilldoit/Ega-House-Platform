"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { updatePersonalOperationsAction } from "./actions";
import type { UserPreferences } from "@ega/domain/preferences";

type Schedule = UserPreferences["personalOperations"];
const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

export function PersonalOperationsForm({ initial, disabled }: { initial: Schedule; disabled: boolean }) {
  const [schedule, setSchedule] = useState(initial);
  const [state, action, pending] = useActionState(updatePersonalOperationsAction, { message: "", ok: false });
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (state.message && !state.ok) errorRef.current?.focus(); }, [state]);
  const totals = days.reduce((sum, day) => ({ work: sum.work + schedule.targets[day].work, search: sum.search + schedule.targets[day].jobSearch }), { work: 0, search: 0 });
  function target(day: typeof days[number], field: "work" | "jobSearch", value: string) {
    setSchedule(current => ({ ...current, targets: { ...current.targets, [day]: { ...current.targets[day], [field]: value === "" ? -1 : Number(value) } } }));
  }
  function block(index: number, change: Partial<Schedule["guidance"][number]>) {
    setSchedule(current => ({ ...current, guidance: current.guidance.map((item, i) => i === index ? { ...item, ...change } : item) }));
  }
  return <form action={action} className="flex flex-col gap-5">
    <fieldset disabled={disabled || pending} className="flex flex-col gap-5">
    <input type="hidden" name="schedule" value={JSON.stringify(schedule)} />
    <label><input type="checkbox" checked={schedule.paused} onChange={e => setSchedule({ ...schedule, paused: e.target.checked })} /> Pause schedule</label>
    <p>{schedule.paused ? "Paused. Your targets are retained." : "Schedule active."} Weekly targets: {totals.work} minutes work; {totals.search} minutes job search.</p>
    <div className="grid gap-3">{days.map(day => <fieldset key={day} className="flex flex-wrap gap-3"><legend className="capitalize">{day}</legend>
      <label>Work minutes <input className="w-24" type="number" min="0" max="1440" required value={schedule.targets[day].work < 0 ? "" : schedule.targets[day].work} onChange={e => target(day, "work", e.target.value)} /></label>
      <label>Job-search minutes <input className="w-24" type="number" min="0" max="1440" required value={schedule.targets[day].jobSearch < 0 ? "" : schedule.targets[day].jobSearch} onChange={e => target(day, "jobSearch", e.target.value)} /></label>
    </fieldset>)}</div>
    <p>Guidance is optional and does not create timers or notifications. Enabled blocks cannot overlap on the same day.</p>
    {schedule.guidance.map((item, index) => <fieldset key={index} className="flex flex-wrap gap-3"><legend>{item.name}</legend>
      <label><input type="checkbox" checked={item.enabled} onChange={e => block(index, { enabled: e.target.checked })} /> Enabled</label>
      <label>Start <input type="time" required value={item.start} onChange={e => block(index, { start: e.target.value })} /></label>
      <label>End <input type="time" required value={item.end} onChange={e => block(index, { end: e.target.value })} /></label>
      <div>{days.map(day => <label key={day} className="mr-2"><input type="checkbox" checked={item.days.includes(day)} onChange={e => block(index, { days: e.target.checked ? [...item.days, day] : item.days.filter(d => d !== day) })} /> {day.slice(0, 3)}</label>)}</div>
    </fieldset>)}
    {state.message && <p ref={errorRef} tabIndex={-1} role={state.ok ? "status" : "alert"}>{state.message}</p>}
    <button type="submit">{pending ? "Saving..." : "Save personal schedule"}</button>
    </fieldset>
  </form>;
}
