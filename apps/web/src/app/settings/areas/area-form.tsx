"use client";

import { useActionState } from "react";

import {
  AREA_COLOR_VALUES,
  AREA_ICON_VALUES,
  type AreaFormValues,
} from "@ega/domain";

import { Input } from "@/components/ui/input";import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { Textarea } from "@/components/ui/textarea";

import type { AreaFormState } from "./actions";

const FIELD_LABEL_CLASS =
  "text-[length:var(--text-body)] font-medium text-[color:var(--ega-text)]";

function labelFor(value: string) {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function AreaForm({
  action,
  areaId,
  initialValues,
  submitLabel,
  pendingLabel,
  idPrefix,
}: {
  action: (state: AreaFormState, formData: FormData) => Promise<AreaFormState>;
  areaId?: string;
  initialValues: AreaFormValues;
  submitLabel: string;
  pendingLabel: string;
  idPrefix: string;
}) {
  const [state, formAction] = useActionState(action, {
    error: null,
    values: initialValues,
  });
  const values = state.values;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {areaId ? <input type="hidden" name="areaId" value={areaId} /> : null}

      <div className="flex flex-col gap-2">
        <label htmlFor={`${idPrefix}-name`} className={FIELD_LABEL_CLASS}>
          Name
        </label>
        <Input
          id={`${idPrefix}-name`}
          name="name"
          required
          maxLength={80}
          autoComplete="off"
          placeholder="Job hunt"
          defaultValue={values.name}
          className="h-8 text-[length:var(--text-meta-lg)]"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label htmlFor={`${idPrefix}-icon`} className={FIELD_LABEL_CLASS}>
            Icon
          </label>
          <div className="flex items-center gap-2">
            <select
              id={`${idPrefix}-icon`}
              name="icon"
              defaultValue={values.icon}
              className="input-instrument h-8 w-full px-2.5 text-[length:var(--text-meta-lg)]"
            >
              {AREA_ICON_VALUES.map((icon) => (
                <option key={icon} value={icon}>
                  {labelFor(icon)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor={`${idPrefix}-color`} className={FIELD_LABEL_CLASS}>
            Colour
          </label>
          <div className="flex items-center gap-2">
            <select
              id={`${idPrefix}-color`}
              name="color"
              defaultValue={values.color}
              className="input-instrument h-8 w-full px-2.5 text-[length:var(--text-meta-lg)]"
            >
              {AREA_COLOR_VALUES.map((color) => (
                <option key={color} value={color}>
                  {labelFor(color)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor={`${idPrefix}-description`} className={FIELD_LABEL_CLASS}>
          Description (optional)
        </label>
        <Textarea
          id={`${idPrefix}-description`}
          name="description"
          maxLength={500}
          placeholder="What this area covers."
          defaultValue={values.description}
          className="text-[length:var(--text-meta-lg)]"
        />
      </div>

      {state.error ? (
        <p role="alert" className="feedback-block feedback-block-error">
          {state.error}
        </p>
      ) : null}

      <div>
        <PendingSubmitButton type="submit" size="sm" pendingLabel={pendingLabel}>
          {submitLabel}
        </PendingSubmitButton>
      </div>
    </form>
  );
}
