const PLATFORM_DOMAIN = "egawilldoit.online";
const LOGIN_HOST = `www.${PLATFORM_DOMAIN}`;

function normalizeHostname(value: string | null) {
  if (!value) {
    return null;
  }

  return value
    .split(",")[0]
    .trim()
    .split(":")[0]
    .toLowerCase();
}

export function resolveSignOutRedirectTarget(
  requestHost: string | null,
  forwardedProto: string | null,
) {
  const hostname = normalizeHostname(requestHost);

  if (!hostname) {
    return "/login";
  }

  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === PLATFORM_DOMAIN ||
    hostname === LOGIN_HOST
  ) {
    return "/login";
  }

  if (hostname.endsWith(`.${PLATFORM_DOMAIN}`)) {
    const protocol = forwardedProto?.toLowerCase() === "http" ? "http" : "https";
    return `${protocol}://${LOGIN_HOST}/login`;
  }

  return "/login";
}

function getSignOutErrorMessage(message: string | undefined) {
  if (!message) {
    return "Unable to sign out right now. Please try again.";
  }

  if (message.toLowerCase().includes("missing env.")) {
    return "Authentication is misconfigured. Contact support.";
  }

  return "Unable to sign out right now. Please try again.";
}

type ExecuteSignOutArgs = {
  signOut: () => Promise<{ error: { message?: string } | null }>;
  requestHost: string | null;
  forwardedProto: string | null;
};

export async function executeSignOut({
  signOut,
  requestHost,
  forwardedProto,
}: ExecuteSignOutArgs) {
  const { error } = await signOut();

  if (error) {
    return {
      error: getSignOutErrorMessage(error.message),
      redirectTo: null,
    };
  }

  return {
    error: null,
    redirectTo: resolveSignOutRedirectTarget(requestHost, forwardedProto),
  };
}
