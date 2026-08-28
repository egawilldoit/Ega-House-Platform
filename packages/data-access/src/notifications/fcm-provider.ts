import type { PushProvider, PushProviderPayload, PushProviderResult } from "@ega/application/notifications/ports";
import { classifyFcmError } from "@ega/application/notifications/delivery";

export type FcmServiceAccount = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

export type FcmProviderConfig = {
  serviceAccount: FcmServiceAccount | null;
  fetchImpl?: typeof fetch;
};

function normalizePrivateKey(key: string): string {
  // Vercel stores multiline private key as escaped \n; normalize to real newlines
  return key.replace(/\\n/g, "\n");
}

export function resolveFcmServiceAccountFromEnv(): FcmServiceAccount | null {
  const json = process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (json) {
    try {
      const parsed = JSON.parse(json) as { project_id?: string; client_email?: string; private_key?: string };
      if (parsed.project_id && parsed.client_email && parsed.private_key) {
        return {
          projectId: parsed.project_id,
          clientEmail: parsed.client_email,
          privateKey: normalizePrivateKey(parsed.private_key),
        };
      }
    } catch {
      // fall through to individual vars
    }
  }

  const projectId = process.env.FCM_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT ?? process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FCM_CLIENT_EMAIL ?? process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKeyRaw = process.env.FCM_PRIVATE_KEY ?? process.env.GOOGLE_PRIVATE_KEY;

  if (projectId && clientEmail && privateKeyRaw) {
    return {
      projectId,
      clientEmail,
      privateKey: normalizePrivateKey(privateKeyRaw),
    };
  }

  return null;
}

async function getAccessToken(serviceAccount: FcmServiceAccount): Promise<string> {
  // Use google-auth-library without hand-rolled JWT
  // Dynamic import so unit tests can run without the dependency installed in minimal env
  const { JWT } = await import("google-auth-library");
  const client = new JWT({
    email: serviceAccount.clientEmail,
    key: serviceAccount.privateKey,
    scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
  });
  const tokens = await client.authorize();
  if (!tokens.access_token) throw new Error("Failed to obtain FCM access token");
  return tokens.access_token;
}

export class FcmPushProvider implements PushProvider {
  private readonly serviceAccount: FcmServiceAccount | null;
  private readonly fetchImpl: typeof fetch;

  constructor(config: FcmProviderConfig) {
    this.serviceAccount = config.serviceAccount;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  static fromEnv(fetchImpl?: typeof fetch): FcmPushProvider {
    return new FcmPushProvider({
      serviceAccount: resolveFcmServiceAccountFromEnv(),
      fetchImpl,
    });
  }

  async send(payload: PushProviderPayload): Promise<PushProviderResult> {
    if (!this.serviceAccount) {
      return {
        ok: false,
        errorCode: "permanent",
        errorReason: "FCM service account not configured. Set FCM_SERVICE_ACCOUNT_JSON or FCM_PROJECT_ID/FCM_CLIENT_EMAIL/FCM_PRIVATE_KEY.",
      };
    }

    if (!payload.token?.trim()) {
      return { ok: false, errorCode: "invalid_endpoint", errorReason: "Missing FCM registration token" };
    }

    let accessToken: string;
    try {
      accessToken = await getAccessToken(this.serviceAccount);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const isAuth = reason.toLowerCase().includes("auth") || reason.toLowerCase().includes("invalid_grant");
      return {
        ok: false,
        errorCode: isAuth ? "auth" : "permanent",
        errorReason: `FCM auth failed: ${reason.slice(0, 500)}`,
      };
    }

    const url = `https://fcm.googleapis.com/v1/projects/${this.serviceAccount.projectId}/messages:send`;

    // FCM data payload values must be strings; already ensured
    const fcmMessage = {
      message: {
        token: payload.token,
        notification: {
          title: payload.title,
          body: payload.body ?? undefined,
        },
        data: payload.data,
        android: {
          priority: "HIGH" as const,
        },
      },
    };

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(fcmMessage),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ok: false, errorCode: "transient", errorReason: `FCM network error: ${reason.slice(0, 400)}` };
    }

    if (response.ok) {
      try {
        const body = (await response.json()) as { name?: string };
        const messageId = body.name ? String(body.name).split("/").pop() ?? body.name : `fcm:${Date.now()}`;
        return { ok: true, providerMessageId: messageId };
      } catch {
        return { ok: true, providerMessageId: `fcm:${Date.now()}` };
      }
    }

    // Parse error
    let fcmCode: string | null = null;
    let message: string | null = null;
    try {
      const errBody = (await response.json()) as { error?: { status?: string; message?: string; details?: unknown } };
      fcmCode = errBody.error?.status ?? null;
      message = errBody.error?.message ?? null;
    } catch {
      // ignore
    }

    const classification = classifyFcmError({
      httpStatus: response.status,
      fcmCode,
      message,
    });

    const reason = message ? `${fcmCode ?? response.status}: ${message}`.slice(0, 500) : `FCM error ${response.status} ${fcmCode ?? ""}`.slice(0, 500);

    return {
      ok: false,
      errorCode: classification,
      errorReason: reason,
      raw: { status: response.status, code: fcmCode, message },
    };
  }
}
