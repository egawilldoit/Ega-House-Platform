export type ReviewDetailRecord = {
  summary: string | null;
  wins: string | null;
  blockers: string | null;
  next_steps: string | null;
};

export function toFieldValue(value: string | null, fallback = "Not provided.") {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : fallback;
}

export function getReviewDetailFields(review: ReviewDetailRecord) {
  return [
    { label: "Summary / Reflection", value: review.summary },
    { label: "Wins", value: review.wins },
    { label: "Blockers", value: review.blockers },
    { label: "Next steps", value: review.next_steps },
  ] as const;
}
