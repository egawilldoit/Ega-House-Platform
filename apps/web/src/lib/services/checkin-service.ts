import {
  createAuthenticatedActor,
  createDailyCheckinService,
} from "@ega/application";
import { SupabaseDailyCheckinRepository } from "@ega/data-access";
import type { DailyCheckin, DailyCheckinPatch } from "@ega/domain/checkins";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/services/auth-service";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

async function buildService(options?: {
  supabase?: SupabaseServerClient;
  getCurrentUser?: () => Promise<{ id: string } | null>;
}) {
  const user = await (options?.getCurrentUser ?? getCurrentUser)();
  if (!user) return null;
  const supabase = options?.supabase ?? (await createClient());
  return {
    userId: user.id,
    service: createDailyCheckinService(
      new SupabaseDailyCheckinRepository(supabase),
    ),
  };
}

export async function getWebDailyCheckin(options: {
  localDate: string;
  supabase?: SupabaseServerClient;
  getCurrentUser?: () => Promise<{ id: string } | null>;
}): Promise<{ checkin: DailyCheckin | null; errorMessage: string | null }> {
  try {
    const built = await buildService(options);
    if (!built) {
      return { checkin: null, errorMessage: "Sign in to load your check-in." };
    }
    const result = await built.service.getDailyCheckin(
      createAuthenticatedActor(built.userId),
      options.localDate,
    );
    if (!result.ok) {
      return { checkin: null, errorMessage: result.errorMessage };
    }
    return { checkin: result.data, errorMessage: null };
  } catch {
    return {
      checkin: null,
      errorMessage: "The check-in could not be loaded right now.",
    };
  }
}

export async function saveWebDailyCheckin(options: {
  localDate: string;
  timezone: string;
  patch: DailyCheckinPatch;
  supabase?: SupabaseServerClient;
  getCurrentUser?: () => Promise<{ id: string } | null>;
}): Promise<{
  checkin: DailyCheckin | null;
  overtimeAdvisory: string | null;
  errorMessage: string | null;
}> {
  try {
    const built = await buildService(options);
    if (!built) {
      return {
        checkin: null,
        overtimeAdvisory: null,
        errorMessage: "Sign in to save your check-in.",
      };
    }
    const result = await built.service.saveDailyCheckin(
      createAuthenticatedActor(built.userId),
      {
        localDate: options.localDate,
        timezone: options.timezone,
        patch: options.patch,
      },
    );
    if (!result.ok) {
      return { checkin: null, overtimeAdvisory: null, errorMessage: result.errorMessage };
    }
    return {
      checkin: result.data.checkin,
      overtimeAdvisory: result.data.overtimeAdvisory,
      errorMessage: null,
    };
  } catch {
    return {
      checkin: null,
      overtimeAdvisory: null,
      errorMessage: "The check-in could not be saved right now. Your entries are still here.",
    };
  }
}
