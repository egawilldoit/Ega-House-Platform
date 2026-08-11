export function missingCronEnvResponse(missing: readonly string[]): Response {
  return Response.json(
    {
      ok: false,
      error: `Missing required environment variable(s): ${missing.join(", ")}`,
    },
    { status: 500 },
  );
}

export function authorizeCronRequest(
  request: Request,
  cronSecret: string | undefined = process.env.CRON_SECRET,
): Response | null {
  if (!cronSecret) {
    return missingCronEnvResponse(["CRON_SECRET"]);
  }

  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  return null;
}

export async function runCronOperation<T extends Record<string, unknown>>(
  operation: () => Promise<T>,
  failureMessage: string,
): Promise<Response> {
  try {
    return Response.json(await operation());
  } catch {
    return Response.json(
      { ok: false, error: failureMessage },
      { status: 500 },
    );
  }
}
