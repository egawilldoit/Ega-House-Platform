export type ReviewFormValues = {
  summary: string;
  wins: string;
  blockers: string;
  nextSteps: string;
  weekOf: string;
};

type ReviewRecordDefaults = {
  summary: string | null;
  wins: string | null;
  blockers: string | null;
  next_steps: string | null;
};

function trimFormValue(value: FormDataEntryValue | string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

export function getEmptyReviewFormValues(weekOf: string): ReviewFormValues {
  return {
    summary: "",
    wins: "",
    blockers: "",
    nextSteps: "",
    weekOf,
  };
}

export function getReviewFormValuesFromFormData(
  formData: FormData,
): ReviewFormValues {
  return {
    summary: trimFormValue(formData.get("summary")),
    wins: trimFormValue(formData.get("wins")),
    blockers: trimFormValue(formData.get("blockers")),
    nextSteps: trimFormValue(formData.get("nextSteps")),
    weekOf: trimFormValue(formData.get("weekOf")),
  };
}

export function getReviewFormValuesFromRecord(
  review: ReviewRecordDefaults,
  weekOf: string,
): ReviewFormValues {
  return {
    summary: review.summary?.trim() ?? "",
    wins: review.wins?.trim() ?? "",
    blockers: review.blockers?.trim() ?? "",
    nextSteps: review.next_steps?.trim() ?? "",
    weekOf,
  };
}

export function toWeekReviewWriteFields(values: ReviewFormValues) {
  return {
    summary: values.summary,
    wins: values.wins || null,
    blockers: values.blockers || null,
    next_steps: values.nextSteps || null,
  };
}
