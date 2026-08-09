import type { CookieOptionsWithName } from "@supabase/ssr";

const PRODUCTION_COOKIE_DOMAIN = ".egawilldoit.online";
const PRODUCTION_HOST = "egawilldoit.online";

function normalizeHostname(hostname?: string | null) {
  return hostname?.split(":")[0].toLowerCase() ?? null;
}

function isProductionHostname(hostname?: string | null) {
  const normalizedHostname = normalizeHostname(hostname);

  if (!normalizedHostname) {
    return false;
  }

  return (
    normalizedHostname === PRODUCTION_HOST ||
    normalizedHostname.endsWith(`.${PRODUCTION_HOST}`)
  );
}

export function getSupabaseCookieOptions(
  hostname?: string | null
): CookieOptionsWithName {
  const baseOptions: CookieOptionsWithName = {
    path: "/",
    sameSite: "lax",
  };

  if (!isProductionHostname(hostname)) {
    return baseOptions;
  }

  return {
    ...baseOptions,
    domain: PRODUCTION_COOKIE_DOMAIN,
    secure: true,
  };
}
