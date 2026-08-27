import { getOrCreateInstallationId, getStoredInstallationId } from './installation';
import { getFcmDeviceToken } from './token';

export async function registerCurrentDevice(): Promise<{ ok: boolean; error?: string }> {
  try {
    const installationId = await getOrCreateInstallationId();
    const token = await getFcmDeviceToken();
    if (!token) {
      return { ok: false, error: 'No FCM token available (permission not granted or token not ready)' };
    }

    const { getMobileEgaApiClient } = await import('@/lib/api/ega');
    const client = getMobileEgaApiClient();

    const result = await client.notifications.registerDevice({
      installationId,
      platform: 'android',
      provider: 'fcm',
      providerToken: token,
    });

    if (!result.ok) {
      return { ok: false, error: result.error.message };
    }

    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message.slice(0, 500) };
  }
}

export async function unregisterCurrentDevice(): Promise<void> {
  try {
    const installationId = await getStoredInstallationId();
    if (!installationId) return;

    const { getMobileEgaApiClient } = await import('@/lib/api/ega');
    const client = getMobileEgaApiClient();
    await client.notifications.unregisterDevice(installationId);
  } catch {
    // Best effort: never block logout
  }
}

/**
 * Called before clearing local session during logout/account switch.
 * Ensures server deactivates this installation for the old user before token is discarded.
 */
export async function bestEffortUnregisterBeforeLogout(): Promise<void> {
  try {
    // Fire and forget with timeout to avoid blocking logout forever
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 3000));
    await Promise.race([unregisterCurrentDevice(), timeout]);
  } catch {
    // ignore
  }
}
