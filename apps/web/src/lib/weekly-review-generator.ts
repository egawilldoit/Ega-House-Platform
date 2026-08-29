/**
 * Weekly Review generator — canonical delegation.
 * Re-exports the shared @ega/application/weekly-review/draft generator so
 * web remains a consumer, not a second source.
 */
export {
  generateWeeklyReviewDraft,
  type WeeklyReviewDraft,
  type WeeklyReviewDraftInput,
  type WeeklyReviewTaskActivity,
  type WeeklyReviewTimeBucket,
} from "@ega/application/weekly-review/draft";
