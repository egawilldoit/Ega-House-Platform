"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const QUICK_STARTERS = [
  "Clear carry-forward items first",
  "Resume current deep-work task",
  "Unblock one critical dependency",
  "Review Today plan before starting timer",
] as const;

type ShutdownReflectionFormProps = {
  action: (formData: FormData) => Promise<void>;
  returnTo: string;
};

export function ShutdownReflectionForm({
  action,
  returnTo,
}: ShutdownReflectionFormProps) {
  const [win, setWin] = useState("");
  const [friction, setFriction] = useState("");
  const [tomorrowStart, setTomorrowStart] = useState("");

  const reflectionNote = useMemo(() => {
    const sections = [
      win.trim() ? `Win: ${win.trim()}` : null,
      friction.trim() ? `Friction: ${friction.trim()}` : null,
      tomorrowStart.trim() ? `Tomorrow start: ${tomorrowStart.trim()}` : null,
    ].filter(Boolean);

    return sections.join("\n");
  }, [friction, tomorrowStart, win]);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="returnTo" value={returnTo} />
      <input type="hidden" name="reflectionNote" value={reflectionNote} />

      <div className="space-y-2">
        <label htmlFor="shutdown-win" className="glass-label text-etch">
          Today&apos;s win
        </label>
        <Textarea
          id="shutdown-win"
          value={win}
          onChange={(event) => setWin(event.target.value)}
          maxLength={180}
          placeholder="What moved forward today?"
          className="min-h-[70px]"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="shutdown-friction" className="glass-label text-etch">
          Friction or blocker
        </label>
        <Textarea
          id="shutdown-friction"
          value={friction}
          onChange={(event) => setFriction(event.target.value)}
          maxLength={180}
          placeholder="What slowed execution down?"
          className="min-h-[70px]"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="shutdown-tomorrow" className="glass-label text-etch">
          Tomorrow starts with
        </label>
        <div className="flex flex-wrap gap-2">
          {QUICK_STARTERS.map((starter) => (
            <button
              key={starter}
              type="button"
              onClick={() => setTomorrowStart(starter)}
              className="filter-pill"
            >
              {starter}
            </button>
          ))}
        </div>
        <Textarea
          id="shutdown-tomorrow"
          value={tomorrowStart}
          onChange={(event) => setTomorrowStart(event.target.value)}
          maxLength={180}
          placeholder="Set a crisp first move for tomorrow."
          className="min-h-[70px]"
        />
      </div>

      <Button type="submit" variant="muted" size="sm" disabled={!reflectionNote.trim()}>
        Save note
      </Button>
    </form>
  );
}

