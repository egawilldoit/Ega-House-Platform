import "server-only";

const HEALTH_PROBE_TIMEOUT_MS = 3000;
const DISCONNECTED_STATUS_TEXT = "Unavailable";
const DISCONNECTED_ERROR_MESSAGE = "OpenClaw is currently unavailable.";
const HEALTH_PROBE_LOG_EVENT = "openclaw_health_probe_failed";

export type OpenClawHealth = {
  reachable: boolean;
  latencyMs: number | null;
  checkedAt: string;
  environment: string;
  openclawUrl: string;
  statusText?: string;
  error?: string;
};

type HealthProbeFailureCategory =
  | "timeout"
  | "network_error"
  | "http_error"
  | "unavailable";

function readRequiredEnv(
  key: "OPENCLAW_PUBLIC_URL" | "OPENCLAW_INTERNAL_URL",
): string {
  const value = process.env[key]?.trim();

  if (!value) {
    throw new Error(`Missing env.${key}`);
  }

  return value;
}

function getAppEnv(): string {
  return process.env.APP_ENV?.trim() || process.env.NODE_ENV || "development";
}

function getOpenClawUrls(): {
  publicUrl: string;
  internalUrl: string;
  healthUrl?: string;
} {
  const healthUrl = process.env.OPENCLAW_HEALTH_URL?.trim();

  return {
    publicUrl: readRequiredEnv("OPENCLAW_PUBLIC_URL"),
    internalUrl: readRequiredEnv("OPENCLAW_INTERNAL_URL"),
    healthUrl: healthUrl || undefined,
  };
}

function getHealthProbeUrl(): string {
  const { healthUrl, internalUrl } = getOpenClawUrls();

  return healthUrl ?? new URL("/health", internalUrl).toString();
}

async function readStatusText(response: Response): Promise<string | undefined> {
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    return undefined;
  }

  try {
    const payload = (await response.json()) as { status?: unknown };

    return typeof payload.status === "string" ? payload.status : undefined;
  } catch {
    return undefined;
  }
}

function getDisconnectedHealth(args: {
  checkedAt: string;
  environment: string;
  openclawUrl: string;
}): OpenClawHealth {
  return {
    reachable: false,
    latencyMs: null,
    checkedAt: args.checkedAt,
    environment: args.environment,
    openclawUrl: args.openclawUrl,
    statusText: DISCONNECTED_STATUS_TEXT,
    error: DISCONNECTED_ERROR_MESSAGE,
  };
}

function getFailureCategory(error: unknown): HealthProbeFailureCategory {
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return "timeout";
    }

    return "network_error";
  }

  return "unavailable";
}

function logFailedHealthProbe(args: {
  checkedAt: string;
  category: HealthProbeFailureCategory;
  environment: string;
  status?: number;
}) {
  console.warn(HEALTH_PROBE_LOG_EVENT, {
    timestamp: args.checkedAt,
    category: args.category,
    environment: args.environment,
    ...(typeof args.status === "number" ? { status: args.status } : {}),
  });
}

export async function getOpenClawHealth(): Promise<OpenClawHealth> {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();
  const environment = getAppEnv();
  const { publicUrl } = getOpenClawUrls();

  try {
    const response = await fetch(getHealthProbeUrl(), {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS),
      headers: {
        Accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
      },
    });

    if (!response.ok) {
      logFailedHealthProbe({
        checkedAt,
        category: "http_error",
        environment,
        status: response.status,
      });

      return getDisconnectedHealth({
        checkedAt,
        environment,
        openclawUrl: publicUrl,
      });
    }

    const latencyMs = Date.now() - startedAt;
    const statusText = await readStatusText(response);

    return {
      reachable: true,
      latencyMs,
      checkedAt,
      environment,
      openclawUrl: publicUrl,
      statusText,
    };
  } catch (error) {
    logFailedHealthProbe({
      checkedAt,
      category: getFailureCategory(error),
      environment,
    });

    return getDisconnectedHealth({
      checkedAt,
      environment,
      openclawUrl: publicUrl,
    });
  }
}
