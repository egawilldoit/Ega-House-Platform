"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

import { submitStoppedTimerOutcomeAction } from "@/app/timer/actions";
import { Button } from "@/components/ui/button";

type TimerStopOutcomePromptProps = {
  taskId: string;
  taskTitle: string;
  returnTo: string;
};

const OUTCOME_OPTIONS = [
  {
    value: "done",
    label: "Done",
    detail: "Stop and mark the task done.",
  },
  {
    value: "in_progress",
    label: "Still in progress",
    detail: "Stop and keep the task active.",
  },
  {
    value: "blocked",
    label: "Blocked",
    detail: "Stop and capture what is blocking it.",
  },
  {
    value: "no_change",
    label: "No status change",
    detail: "Only stop the timer.",
  },
] as const;

function SubmitOutcomeButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Saving..." : "Save outcome"}
    </Button>
  );
}

export function TimerStopOutcomePrompt({
  taskId,
  taskTitle,
  returnTo,
}: TimerStopOutcomePromptProps) {
  const [selectedOutcome, setSelectedOutcome] =
    useState<(typeof OUTCOME_OPTIONS)[number]["value"]>("done");
  const blockedReasonId = `timer-blocked-reason-${taskId}`;

  return (
    <section className="rounded-[1rem] border border-[var(--border)] bg-[color:var(--instrument)] p-4">
      <p className="glass-label text-etch">Timer stopped</p>
      <p className="mt-2 text-sm text-[color:var(--foreground)]">
        What happened with <span className="font-medium">{taskTitle}</span>?
      </p>

      <form action={submitStoppedTimerOutcomeAction} className="mt-4 space-y-4">
        <input type="hidden" name="taskId" value={taskId} />
        <input type="hidden" name="returnTo" value={returnTo} />

        <fieldset className="grid gap-2">
          <legend className="sr-only">Timer outcome</legend>
          {OUTCOME_OPTIONS.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-start gap-3 rounded-[0.8rem] border border-[var(--border)] bg-white px-3 py-3 text-sm transition hover:border-[var(--signal-live)]"
            >
              <input
                type="radio"
                name="outcome"
                value={option.value}
                checked={selectedOutcome === option.value}
                onChange={() => setSelectedOutcome(option.value)}
                className="mt-1"
              />
              <span className="min-w-0">
                <span className="block font-medium text-[color:var(--foreground)]">
                  {option.label}
                </span>
                <span className="mt-1 block text-xs leading-5 text-[color:var(--muted-foreground)]">
                  {option.detail}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        {selectedOutcome === "blocked" ? (
          <div className="space-y-2">
            <label htmlFor={blockedReasonId} className="glass-label text-etch">
              Blocked reason
            </label>
            <textarea
              id={blockedReasonId}
              name="blockedReason"
              required
              rows={3}
              minLength={2}
              className="input-instrument min-h-20 w-full resize-y px-3 py-2 text-sm normal-case tracking-normal"
              placeholder="What is blocking the next step?"
            />
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <SubmitOutcomeButton />
        </div>
      </form>
    </section>
  );
}
