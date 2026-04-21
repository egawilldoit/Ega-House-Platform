"use client";

import { useEffect } from "react";

import { clearTimerFlashParamsFromHref } from "@/app/timer/flash-query";

type TimerActionFeedbackProps = {
  actionError: string | null;
  actionSuccess: string | null;
};

export function TimerActionFeedback({
  actionError,
  actionSuccess,
}: TimerActionFeedbackProps) {
  useEffect(() => {
    if (!actionError && !actionSuccess) {
      return;
    }

    const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const nextHref = clearTimerFlashParamsFromHref(currentHref);
    if (nextHref !== currentHref) {
      window.history.replaceState(window.history.state, "", nextHref);
    }
  }, [actionError, actionSuccess]);

  return (
    <>
      {actionError ? (
        <div className="feedback-block feedback-block-error mt-4 px-5 py-3">
          <p className="glass-label text-signal-error">{actionError}</p>
        </div>
      ) : null}
      {actionSuccess ? (
        <div className="feedback-block feedback-block-success mt-4 px-5 py-3">
          <p className="glass-label text-signal-live">{actionSuccess}</p>
        </div>
      ) : null}
    </>
  );
}
