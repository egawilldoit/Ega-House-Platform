import { StartupPlanner } from "@/components/startup/startup-planner";
import { Card, CardContent } from "@/components/ui/card";
import type { StartupPageModel } from "../_lib/startup-page-model";

export function StartupErrorView({ actionError }: { actionError: string | null }) {
  return (
    <div className="flex flex-col gap-4">
      {actionError ? <p className="feedback-block feedback-block-error">{actionError}</p> : null}
      <Card>
        <CardContent>
          <p className="text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-[color:var(--ega-text-secondary)]">
            Could not load weekly startup planning right now. Try again shortly.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export function StartupPageView({ model }: { model: StartupPageModel }) {
  const { actionError, actionSuccess, startupResult } = model;
  if (startupResult.errorMessage || !startupResult.data) {
    return <StartupErrorView actionError={actionError} />;
  }

  return (
    <>
      {actionSuccess ? <p className="feedback-block mb-4">{actionSuccess}</p> : null}
      {actionError ? <p className="feedback-block feedback-block-error mb-4">{actionError}</p> : null}
      <StartupPlanner data={startupResult.data} returnTo="/startup" />
    </>
  );
}
