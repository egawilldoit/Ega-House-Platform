"use client";

import {
  QuickNotesEditor,
  type QuickNotesEditorProps,
} from "@/components/quick-notes/quick-notes-editor";
import {
  PopoutTimerSummary,
  type TimerPopoutViewProps,
} from "@/components/timer/floating-timer/timer-popout-view";

export type FloatingPopoutViewProps = {
  /** Null in notes-only mode; pinned session keeps timer semantics intact. */
  timer: TimerPopoutViewProps | null;
  notes: Omit<QuickNotesEditorProps, "variant">;
};

/**
 * The single always-on-top window. Timer and Notes share one Document PiP
 * window and one React root: either can be absent, neither replaces the other,
 * and the timer keeps its pinned-session stop semantics.
 */
export function FloatingPopoutView({ timer, notes }: FloatingPopoutViewProps) {
  return (
    <div
      className="ega-timer-popout ega-floating-popout"
      role="region"
      aria-label={timer ? "Quick notes and focus timer" : "Quick notes"}
    >
      {timer ? (
        <div className="ega-floating-popout__timer">
          <PopoutTimerSummary {...timer} />
        </div>
      ) : null}

      <div className="ega-floating-popout__notes">
        <h2 className="ega-floating-popout__notes-title">Quick notes</h2>
        <QuickNotesEditor {...notes} variant="popout" />
      </div>
    </div>
  );
}
