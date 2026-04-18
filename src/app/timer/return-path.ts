const TIMER_PATH = "/timer";
const DASHBOARD_PATH = "/dashboard";

export function getTimerActionReturnPath(rawReturnTo: unknown) {
  const returnTo = String(rawReturnTo ?? "").trim();

  if (returnTo.startsWith(TIMER_PATH) || returnTo.startsWith(DASHBOARD_PATH)) {
    return returnTo;
  }

  return TIMER_PATH;
}
