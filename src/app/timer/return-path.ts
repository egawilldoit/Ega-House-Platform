const TIMER_PATH = "/timer";
const DASHBOARD_PATH = "/dashboard";
const TODAY_PATH = "/today";

export function getTimerActionReturnPath(rawReturnTo: unknown) {
  const returnTo = String(rawReturnTo ?? "").trim();

  if (
    returnTo.startsWith(TIMER_PATH) ||
    returnTo.startsWith(DASHBOARD_PATH) ||
    returnTo.startsWith(TODAY_PATH)
  ) {
    return returnTo;
  }

  return TIMER_PATH;
}
