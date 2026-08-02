const PLATFORM_HOST = "egawilldoit.online";
const DEFAULT_FALLBACK = "/dashboard";

function isLoopbackHost(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function isPlatformHost(hostname: string) {
  return hostname === PLATFORM_HOST || hostname.endsWith(`.${PLATFORM_HOST}`);
}

function isAllowedDestination(url: URL) {
  if (url.username || url.password) {
    return false;
  }

  if (isPlatformHost(url.hostname)) {
    return url.protocol === "https:";
  }

  if (isLoopbackHost(url.hostname)) {
    return url.protocol === "http:" || url.protocol === "https:";
  }

  return false;
}

export function resolveSafeAuthDestination(
  raw: string | null | undefined,
  origin: string,
  fallback = DEFAULT_FALLBACK,
): URL {
  const base = new URL(origin);
  const fallbackUrl = new URL(fallback, base);

  if (!raw || raw.startsWith("//")) {
    return fallbackUrl;
  }

  const isInternalPath = raw.startsWith("/");
  const isAbsoluteHttpUrl = /^https?:\/\//i.test(raw);
  if (!isInternalPath && !isAbsoluteHttpUrl) {
    return fallbackUrl;
  }

  try {
    const candidate = new URL(raw, base);
    return isAllowedDestination(candidate) ? candidate : fallbackUrl;
  } catch {
    return fallbackUrl;
  }
}

export function toInternalDestination(url: URL, origin: string): string | null {
  const currentOrigin = new URL(origin);
  if (url.origin !== currentOrigin.origin) {
    return null;
  }

  return `${url.pathname}${url.search}${url.hash}`;
}
