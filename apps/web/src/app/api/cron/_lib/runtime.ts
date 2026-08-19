export function missingCronEnvResponse(missing: readonly string[]): Response {
  return Response.json(
    {
      ok: false,
      error: `Missing required environment variable(s): ${missing.join(", ")}`,
    },
    { status: 500 },
  );
}

/**
 * Shared cron transport authorization. Returns a response when the request
 * must stop, otherwise null. Secret ownership stays in the environment and
 * every existing cron route keeps the exact Bearer comparison semantics.
 */
export function authorizeCronRequest(
  request: Request,
  cronSecret = process.env.CRON_SECRET,
): Response | null {
  if (!cronSecret) {
    return missingCronEnvResponse(["CRON_SECRET"]);
  }

  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
