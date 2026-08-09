const TIMER_REDIRECT_BASE_URL = "https://egawilldoit.online";

export type TimerFlashRedirectOptions = {
  errorMessage?: string;
  successMessage?: string;
  anchor?: string;
};

export function buildTimerRedirectHref(
  returnPath: string,
  options?: TimerFlashRedirectOptions,
) {
  if (!options?.errorMessage && !options?.successMessage && !options?.anchor) {
    return returnPath;
  }

  const target = new URL(returnPath, TIMER_REDIRECT_BASE_URL);
  if (options?.errorMessage) {
    target.searchParams.set("actionError", options.errorMessage);
  }
  if (options?.successMessage) {
    target.searchParams.set("actionSuccess", options.successMessage);
  }

  return `${target.pathname}${target.search}${options?.anchor ?? ""}`;
}

export function clearTimerFlashParamsFromHref(href: string) {
  const target = new URL(href, TIMER_REDIRECT_BASE_URL);
  target.searchParams.delete("actionError");
  target.searchParams.delete("actionSuccess");

  return `${target.pathname}${target.search}${target.hash}`;
}
