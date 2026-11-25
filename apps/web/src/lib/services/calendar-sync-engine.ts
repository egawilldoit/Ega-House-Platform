import type { AuthenticatedActor } from "@ega/application";
import {
  continueCalendarSync,
  getCalendarSyncStatus,
  processCalendarRecovery,
  retryCalendarSync,
  startCalendarSync,
  type CalendarSyncDependencies,
} from "@ega/application/calendar-sync/service";
import {
  GoogleCalendarEventProvider,
  SupabaseCalendarSyncRepository,
} from "@ega/data-access";

import { createClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  decryptCalendarToken,
  encryptCalendarToken,
} from "@/lib/services/calendar-token-crypto";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

function resolveLinkBaseUrl(origin: string) {
  return (
    process.env.APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    origin
  );
}

function buildDependencies(
  supabase: SupabaseServerClient | ReturnType<typeof getSupabaseServiceClient>,
  options: {
    origin: string;
    scope: "owner" | "service";
    now?: () => Date;
  },
): CalendarSyncDependencies {
  return {
    repository: new SupabaseCalendarSyncRepository(supabase as never, {
      scope: options.scope,
    }),
    provider: new GoogleCalendarEventProvider({
      decryptToken: decryptCalendarToken,
      encryptToken: encryptCalendarToken,
    }),
    config: {
      linkBaseUrl: resolveLinkBaseUrl(options.origin),
      scanPageSize: 100,
      jobLimit: 8,
      requestBudgetMs: 20_000,
      leaseSeconds: 180,
    },
    now: options.now,
  };
}

async function resolveActor(
  supabase: SupabaseServerClient,
): Promise<AuthenticatedActor | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.id) return null;
  return { userId: data.user.id };
}

export async function getWebCalendarSyncStatus(origin: string) {
  const supabase = await createClient();
  const actor = await resolveActor(supabase);
  if (!actor) {
    return {
      ok: false as const,
      status: 401,
      errorMessage: "Sign in to synchronize Google Calendar.",
    };
  }

  const result = await getCalendarSyncStatus(
    actor,
    buildDependencies(supabase, { origin, scope: "owner" }),
  );
  if (!result.ok) {
    const status = /unable to load|unable to claim|unable to save|unable to start|unable to continue|unable to settle|unable to finalize|unable to advance|unable to verify|unable to record/i.test(
      result.errorMessage,
    )
      ? 503
      : 400;
    return {
      ok: false as const,
      status,
      errorMessage: result.errorMessage,
    };
  }

  return { ok: true as const, data: result.data };
}

export async function startWebCalendarSync(
  origin: string,
  options?: { retryMode?: boolean },
) {
  const supabase = await createClient();
  const actor = await resolveActor(supabase);
  if (!actor) {
    return {
      ok: false as const,
      status: 401,
      errorMessage: "Sign in to synchronize Google Calendar.",
    };
  }

  const deps = buildDependencies(supabase, { origin, scope: "owner" });
  const result = options?.retryMode
    ? await retryCalendarSync(actor, deps)
    : await startCalendarSync(actor, deps);

  if (!result.ok) {
    const isOperational = /unable to load|unable to claim|unable to save|unable to start|unable to settle|unable to finalize|unable to advance|unable to verify|unable to record/i.test(
      result.errorMessage,
    );
    return {
      ok: false as const,
      status: result.code === "validation"
        ? 409
        : isOperational
          ? 503
          : 400,
      errorMessage: result.errorMessage,
      reason: result.reason,
    };
  }

  return { ok: true as const, data: result.data };
}

export async function continueWebCalendarSync(origin: string, runId: string) {
  const supabase = await createClient();
  const actor = await resolveActor(supabase);
  if (!actor) {
    return {
      ok: false as const,
      status: 401,
      errorMessage: "Sign in to synchronize Google Calendar.",
    };
  }

  const result = await continueCalendarSync(
    actor,
    buildDependencies(supabase, { origin, scope: "owner" }),
    runId,
  );

  if (!result.ok) {
    const isOperational = /unable to load|unable to claim|unable to save|unable to settle|unable to finalize|unable to advance|unable to verify|unable to record/i.test(
      result.errorMessage,
    );
    return {
      ok: false as const,
      status: result.code === "notFound"
        ? 404
        : isOperational
          ? 503
          : 400,
      errorMessage: result.errorMessage,
    };
  }

  return { ok: true as const, data: result.data };
}

/**
 * Scheduled recovery is intentionally independent of a browser session. It
 * resumes unfinished runs and drains destination-bound mutation jobs with the
 * server-only Supabase client. Google tokens still stay encrypted at rest.
 */
export async function runWebCalendarRecovery(origin: string) {
  const supabase = getSupabaseServiceClient();
  const actor: AuthenticatedActor = { userId: "system" };

  return processCalendarRecovery(
    actor,
    buildDependencies(supabase, { origin, scope: "service" }),
    { runLimit: 5, destinationLimit: 5 },
  );
}

/** Opportunistically drain the signed-in owner's scheduled Calendar jobs. */
export async function runOwnerCalendarRecovery() {
  const supabase = await createClient();
  const actor = await resolveActor(supabase);
  if (!actor) return;
  const origin = process.env.APP_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!origin) return;
  return processCalendarRecovery(
    actor,
    buildDependencies(supabase, { origin, scope: "owner" }),
    { runLimit: 1, destinationLimit: 1 },
  );
}
