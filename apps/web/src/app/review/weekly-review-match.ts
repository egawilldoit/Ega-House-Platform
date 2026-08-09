type WeekReviewLookupRow = {
  id: string;
  owner_user_id: string | null;
  week_start: string;
  week_end: string;
  created_at: string | null;
  updated_at: string | null;
};

type WeeklyReviewMatchParams = {
  ownerUserId: string;
  weekStart: string;
  weekEnd: string;
};

function toUnixMillis(value: string | null) {
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }

  const millis = new Date(value).getTime();
  return Number.isNaN(millis) ? Number.NEGATIVE_INFINITY : millis;
}

export function resolveMatchingWeeklyReview(
  rows: WeekReviewLookupRow[],
  { ownerUserId, weekStart, weekEnd }: WeeklyReviewMatchParams,
) {
  return (
    rows
      .filter(
        (row) =>
          row.owner_user_id === ownerUserId &&
          row.week_start === weekStart &&
          row.week_end === weekEnd,
      )
      .sort((left, right) => {
        const updatedDiff =
          toUnixMillis(right.updated_at) - toUnixMillis(left.updated_at);
        if (updatedDiff !== 0) {
          return updatedDiff;
        }

        const createdDiff =
          toUnixMillis(right.created_at) - toUnixMillis(left.created_at);
        if (createdDiff !== 0) {
          return createdDiff;
        }

        return right.id.localeCompare(left.id);
      })[0] ?? null
  );
}
