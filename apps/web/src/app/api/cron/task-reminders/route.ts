import {
  authorizeCronRequest,
  runCronOperation,
} from "@/lib/cron/route-runtime";
import { getResendClient } from "@/lib/email/resend";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  processDueTaskReminders,
  processPendingNotificationDeliveries,
} from "@ega/application/notifications/service";
import {
  SupabaseNotificationDeliveryRepository,
  SupabaseNotificationDeviceRepository,
  SupabaseNotificationPreferenceRepository,
  SupabaseNotificationRepository,
  SupabaseTaskReminderIntentRepository,
} from "@ega/data-access/notifications/repository";
import { FcmPushProvider } from "@ega/data-access/notifications/fcm-provider";
import { ResendEmailProvider, SupabaseEmailResolver } from "@ega/data-access/notifications/email-provider";

export async function POST(request: Request) {
  const unauthorized = authorizeCronRequest(request);
  if (unauthorized) return unauthorized;

  return runCronOperation(async () => {
    const supabase = getSupabaseServiceClient() as never;

    const notificationRepo = new SupabaseNotificationRepository(supabase);
    const deliveryRepo = new SupabaseNotificationDeliveryRepository(supabase);
    const deviceRepo = new SupabaseNotificationDeviceRepository(supabase);
    const preferenceRepo = new SupabaseNotificationPreferenceRepository(supabase);
    const intentRepo = new SupabaseTaskReminderIntentRepository(supabase);

    const dueResult = await processDueTaskReminders(null, {
      notificationRepository: notificationRepo,
      deliveryRepository: deliveryRepo,
      deviceRepository: deviceRepo,
      preferenceRepository: preferenceRepo,
      intentRepository: intentRepo,
      now: new Date(),
      limit: 25,
    });

    if (!dueResult.ok) {
      throw new Error(dueResult.errorMessage);
    }

    // Prepare providers for delivery processing
    const fcmProvider = FcmPushProvider.fromEnv();
    const resendApiKey = process.env.RESEND_API_KEY;
    const emailFrom = process.env.EMAIL_FROM ?? "noreply@egawilldoit.online";

    const emailProvider = resendApiKey
      ? new ResendEmailProvider(getResendClient(resendApiKey), emailFrom)
      : ({
          async send() {
            return { ok: false as const, errorCode: "permanent" as const, errorReason: "Resend not configured" };
          },
        } as never);

    const emailResolver = new SupabaseEmailResolver(supabase as never);

    const deliveryResult = await processPendingNotificationDeliveries({
      deliveryRepository: deliveryRepo,
      deviceRepository: deviceRepo,
      pushProvider: fcmProvider,
      emailProvider,
      emailResolver,
      notificationRepository: notificationRepo,
      now: new Date(),
      limit: 25,
    });

    if (!deliveryResult.ok) {
      throw new Error(deliveryResult.errorMessage);
    }

    return {
      ok: true as const,
      due: dueResult.data,
      deliveries: deliveryResult.data,
    };
  }, "Failed to process task reminder notifications.");
}
