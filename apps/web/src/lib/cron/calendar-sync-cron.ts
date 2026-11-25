export async function executeCalendarSyncCron(
  origin: string,
  deps: Readonly<{
    runRecovery: (
      origin: string,
    ) => Promise<
      | { ok: true; data: unknown }
      | { ok: false; errorMessage: string }
    >;
    processLegacy: () => Promise<{ ok: boolean; [key: string]: unknown }>;
  }>,
): Promise<Response> {
  try {
    const recovery = await deps.runRecovery(origin);
    const legacy = await deps.processLegacy();
    const ok = recovery.ok && legacy.ok;

    return Response.json(
      {
        ok,
        recovery: recovery.ok
          ? recovery.data
          : { error: recovery.errorMessage },
        legacy,
      },
      { status: ok ? 200 : 500 },
    );
  } catch {
    return Response.json(
      { ok: false, error: "Failed to process Calendar sync jobs." },
      { status: 500 },
    );
  }
}
