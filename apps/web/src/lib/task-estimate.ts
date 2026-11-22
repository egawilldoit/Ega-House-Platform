export {
  normalizeTaskEstimateInput,
  TASK_ESTIMATE_MAX_MINUTES,
} from "@ega/domain";

export function formatTaskEstimate(minutes: number | null | undefined) {
  if (!Number.isFinite(minutes) || minutes === null || minutes === undefined) {
    return null;
  }

  const safeMinutes = Math.max(0, Math.floor(minutes));

  if (safeMinutes === 0) {
    return "0m";
  }

  const hours = Math.floor(safeMinutes / 60);
  const remainingMinutes = safeMinutes % 60;

  if (hours === 0) {
    return `${remainingMinutes}m`;
  }

  if (remainingMinutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${remainingMinutes}m`;
}
