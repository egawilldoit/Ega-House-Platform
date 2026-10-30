"use client";

import { Check } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { PriorityIcon, type TaskPriorityIconName } from "@/components/ui/priority-icon";
import { formatDisplayDate } from "@/lib/presentation-format";
import { formatTaskEstimate } from "@/lib/task-estimate";
import { cn } from "@/lib/utils";

export type TemplatePickerTaskPreview = {
  title: string;
  dueDate: string;
  priority: TaskPriorityIconName;
  estimateMinutes: number | null;
};

export type TemplatePickerGoalPreview = {
  title: string;
  description: string | null;
  tasks: TemplatePickerTaskPreview[];
};

export type TemplatePickerOption = {
  id: string;
  name: string;
  summary: string;
  projectDescription: string;
  goalCount: number;
  taskCount: number;
  goals: TemplatePickerGoalPreview[];
};

type TemplatePickerProps = {
  options: TemplatePickerOption[];
  value: string;
  onChange: (templateId: string) => void;
};

const CARD_CLASS = cn(
  "flex h-full min-h-11 flex-col gap-1 rounded-[var(--radius-md)] border",
  "border-[var(--ega-border)] bg-[color:var(--ega-surface)] p-3",
  "transition-colors hover:border-[var(--ega-border-strong)]",
  "peer-checked:border-[color:var(--ega-accent)]",
  "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2",
  "peer-focus-visible:outline-[var(--ega-focus-outline)]",
);

function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function TemplatePreview({ option }: { option: TemplatePickerOption }) {
  if (option.goals.length === 0) {
    return (
      <p className="text-[length:var(--text-meta-lg)] leading-[var(--leading-snug)] text-ega-text-secondary">
        No goals or tasks will be created. You can add them once the project exists.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-4">
      {option.goals.map((goal) => (
        <li key={goal.title} className="flex flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <p className="text-[length:var(--text-meta-lg)] font-semibold text-[color:var(--ega-text)]">
              {goal.title}
            </p>
            {goal.description ? (
              <p className="text-[length:var(--text-meta)] leading-[var(--leading-snug)] text-ega-text-tertiary">
                {goal.description}
              </p>
            ) : null}
          </div>
          <ul className="flex flex-col gap-1.5 border-l border-[var(--ega-border)] pl-3">
            {goal.tasks.map((task) => {
              const estimate = formatTaskEstimate(task.estimateMinutes);
              return (
                <li key={task.title} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <PriorityIcon priority={task.priority} />
                  <span className="min-w-0 break-words text-[length:var(--text-meta-lg)] text-[color:var(--ega-text)]">
                    {task.title}
                  </span>
                  <span className="text-[length:var(--text-meta)] tabular-nums text-ega-text-tertiary">
                    Due {formatDisplayDate(task.dueDate, "compact")}
                  </span>
                  {estimate ? (
                    <Badge tone="muted" className="tabular-nums">
                      {estimate}
                    </Badge>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ul>
  );
}

/**
 * Template picker for project creation.
 *
 * Semantics: a native radio group inside one fieldset. Native radios keep the
 * arrow-key/Home/End behaviour, the label is the hit target on touch, and the
 * visible focus ring is drawn on the card through `peer-focus-visible`. The
 * preview is derived from the same server-resolved options the form submits, so
 * it cannot drift from what gets created.
 *
 * Motion: the card only changes colour; no transform or animation is used, so
 * reduced-motion preferences need no extra branch.
 */
export function TemplatePicker({ options, value, onChange }: TemplatePickerProps) {
  const selected = options.find((option) => option.id === value) ?? options[0];

  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-[length:var(--text-body)] font-medium text-[color:var(--ega-text)]">
          Start from
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {options.map((option) => (
            <label key={option.id} className="relative flex cursor-pointer">
              <input
                type="radio"
                name="templateId"
                value={option.id}
                checked={value === option.id}
                onChange={() => onChange(option.id)}
                className="peer sr-only"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute right-3 top-3 text-[color:var(--ega-accent)] opacity-0 peer-checked:opacity-100"
              >
                <Check className="size-4" />
              </span>
              <span className={CARD_CLASS}>
                <span className="flex flex-wrap items-baseline justify-between gap-2 pr-5">
                  <span className="text-[length:var(--text-body)] font-medium text-[color:var(--ega-text)]">
                    {option.name}
                  </span>
                  <span className="text-[length:var(--text-meta)] tabular-nums text-ega-text-tertiary">
                    {option.goalCount === 0
                      ? "No goals"
                      : countLabel(option.taskCount, "task", "tasks")}
                  </span>
                </span>
                <span className="text-[length:var(--text-meta)] leading-[var(--leading-snug)] text-ega-text-secondary">
                  {option.summary}
                </span>
              </span>
            </label>
          ))}
        </div>
        <p className="text-[length:var(--text-meta)] text-ega-text-tertiary">
          Use arrow keys to move between templates. Dates use your saved time zone.
        </p>
      </fieldset>

      {selected ? (
        <div className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--ega-border)] bg-[color:var(--ega-surface-subtle)] p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="text-[length:var(--text-meta-lg)] font-semibold text-[color:var(--ega-text)]">
              What will be created
            </h4>
            <p aria-live="polite" className="text-[length:var(--text-meta)] tabular-nums text-ega-text-secondary">
              {countLabel(selected.goalCount, "goal", "goals")} ·{" "}
              {countLabel(selected.taskCount, "task", "tasks")}
            </p>
          </div>
          <TemplatePreview option={selected} />
        </div>
      ) : null}
    </div>
  );
}
