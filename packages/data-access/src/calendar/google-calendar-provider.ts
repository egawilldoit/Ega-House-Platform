import type {
  CalendarConnectionRecord,
  CalendarEventDocument,
  CalendarEventIndexEntry,
  CalendarEventPayload,
  CalendarEventProvider,
  CalendarEventTime,
  CalendarProviderFailure,
  CalendarProviderResult,
  RefreshedCalendarCredentials,
} from "@ega/application/calendar-sync/ports";

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

type GoogleEventResource = {
  id?: string;
  status?: string;
  summary?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  extendedProperties?: { private?: Record<string, string> };
  error?: { message?: string; errors?: Array<{ reason?: string; message?: string }> };
};

export type GoogleCalendarProviderOptions = Readonly<{
  decryptToken: (value: string | null | undefined) => string | null;
  encryptToken: (value: string) => string;
  clientId?: string | null;
  clientSecret?: string | null;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  requestTimeoutMs?: number;
}>;

function optionalEnv(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function classifyGoogleFailure(input: {
  status: number;
  message: string;
  reason?: string | null;
  retryAfterSeconds?: number;
}): CalendarProviderFailure {
  const reason = (input.reason ?? "").toLowerCase();
  const message = input.message.toLowerCase();

  if (input.status === 401) {
    return {
      kind: "authorization",
      message: "Google Calendar authorization expired. Reconnect Google Calendar.",
    };
  }

  if (input.status === 403) {
    if (
      reason.includes("ratelimit") ||
      reason.includes("userratelimit") ||
      message.includes("rate limit") ||
      message.includes("quota")
    ) {
      return {
        kind: "retryable",
        message: "Google Calendar rate limit reached. Sync will retry with backoff.",
        retryAfterSeconds: input.retryAfterSeconds,
      };
    }

    return {
      kind: "permanent",
      message:
        "Google Calendar denied access. Reconnect Google Calendar and confirm Calendar access.",
    };
  }

  if (input.status === 404 || input.status === 410) {
    return { kind: "not_found", message: "Google Calendar event was not found." };
  }

  if (input.status === 409) {
    return {
      kind: "conflict",
      message: "A Google Calendar event with this id already exists.",
    };
  }

  if (input.status === 429 || input.status >= 500) {
    return {
      kind: "retryable",
      message: "Google Calendar is temporarily unavailable. Sync will retry.",
      retryAfterSeconds: input.retryAfterSeconds,
    };
  }

  return {
    kind: "permanent",
    message: input.message || "Google Calendar rejected the request.",
  };
}

function parseRetryAfter(value: string | null) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return Math.max(0, Math.ceil((date.getTime() - Date.now()) / 1000));
}

function timeFromGoogle(value: { date?: string; dateTime?: string } | undefined): CalendarEventTime | null {
  if (!value) return null;
  if (value.dateTime) return { dateTime: value.dateTime };
  if (value.date) return { date: value.date };
  return null;
}

function timeToGoogle(value: CalendarEventTime, patch: boolean) {
  if ("date" in value && value.date) {
    return patch
      ? { date: value.date, dateTime: null, timeZone: null }
      : { date: value.date };
  }
  return {
    dateTime: value.dateTime,
    ...(value.timeZone ? { timeZone: value.timeZone } : {}),
    ...(patch ? { date: null } : {}),
  };
}

function documentFromResource(resource: GoogleEventResource): CalendarEventDocument {
  return {
    id: String(resource.id ?? ""),
    status: String(resource.status ?? "confirmed"),
    summary: resource.summary ?? null,
    start: timeFromGoogle(resource.start),
    end: timeFromGoogle(resource.end),
    privateProperties: resource.extendedProperties?.private ?? {},
    raw: resource as Record<string, unknown>,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePrivateProperties(
  value: unknown,
): Record<string, string> | null {
  if (value === undefined) return {};
  if (!isRecord(value)) return null;
  const properties: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    // Extended property values are strings. Treat anything else as a
    // malformed page instead of silently dropping a tag that proves a managed
    // event still exists.
    if (typeof entry !== "string") return null;
    properties[key] = entry;
  }
  return properties;
}

function managedEventIndexEntry(
  item: unknown,
): CalendarEventIndexEntry | null {
  if (!isRecord(item)) return null;
  if (typeof item.id !== "string" || item.id.length === 0) return null;
  if (item.status !== undefined && typeof item.status !== "string") return null;

  let privateProperties: Record<string, string> = {};
  if (item.extendedProperties !== undefined) {
    if (!isRecord(item.extendedProperties)) return null;
    const parsed = parsePrivateProperties(item.extendedProperties.private);
    if (!parsed) return null;
    privateProperties = parsed;
  }

  return {
    id: item.id,
    status: item.status ?? "confirmed",
    source: privateProperties.source ?? null,
    taskId: privateProperties.task_id ?? null,
    ownerUserId: privateProperties.owner_user_id ?? null,
    destinationKey: privateProperties.destination_key ?? null,
    generation: privateProperties.generation
      ? Number(privateProperties.generation)
      : null,
    payloadHash: privateProperties.payload_hash ?? null,
  };
}

function managedEventPage(payload: unknown): {
  events: CalendarEventIndexEntry[];
  nextPageToken: string | null;
} | null {
  if (!isRecord(payload) || "error" in payload) return null;

  const items = payload.items;
  if (items !== undefined && !Array.isArray(items)) return null;

  const events: CalendarEventIndexEntry[] = [];
  for (const item of items ?? []) {
    const entry = managedEventIndexEntry(item);
    if (!entry) return null;
    events.push(entry);
  }

  const token = payload.nextPageToken;
  if (
    token !== undefined &&
    token !== null &&
    (typeof token !== "string" || token.trim().length === 0)
  ) {
    return null;
  }

  return {
    events,
    nextPageToken: typeof token === "string" ? token : null,
  };
}

function eventDocument(
  payload: unknown,
  expectedEventId: string,
): CalendarEventDocument | null {
  if (!isRecord(payload)) return null;
  if (payload.id !== expectedEventId) return null;
  if (payload.status !== undefined && typeof payload.status !== "string") {
    return null;
  }
  if (payload.extendedProperties !== undefined) {
    if (!isRecord(payload.extendedProperties)) return null;
    if (
      parsePrivateProperties(payload.extendedProperties.private) === null
    ) {
      return null;
    }
  }
  return documentFromResource(payload as GoogleEventResource);
}

const MALFORMED_LISTING_MESSAGE =
  "Google Calendar returned an unreadable event listing. No Calendar changes were made; sync will retry.";
const MALFORMED_LOOKUP_MESSAGE =
  "Google Calendar returned an unreadable event lookup. The saved event was left unchanged; sync will retry.";

function eventBody(payload: CalendarEventPayload, patch = false) {
  return {
    ...(!patch ? { id: payload.eventId } : {}),
    summary: payload.summary,
    description: payload.description,
    start: timeToGoogle(payload.start, patch),
    end: timeToGoogle(payload.end, patch),
    reminders: {
      useDefault: false,
      overrides: [{ method: "popup", minutes: payload.reminderMinutes }],
    },
    extendedProperties: {
      private: payload.privateProperties,
    },
  };
}

function boundaryMatches(
  actual: unknown,
  expected: CalendarEventTime,
): boolean {
  if (!isRecord(actual)) return false;
  if (expected.date) {
    return actual.date === expected.date && !("dateTime" in actual);
  }
  return (
    typeof expected.dateTime === "string" &&
    !("date" in actual) &&
    typeof actual.dateTime === "string" &&
    Date.parse(actual.dateTime) === Date.parse(expected.dateTime)
  );
}

function writtenEvent(
  resource: unknown,
  eventId: string,
  payload: CalendarEventPayload,
): CalendarEventDocument | null {
  if (
    !isRecord(resource) ||
    !boundaryMatches(resource.start, payload.start) ||
    !boundaryMatches(resource.end, payload.end)
  ) return null;

  const document = eventDocument(resource, eventId);
  return document?.privateProperties.source === "ega-house" && document.status !== "cancelled"
    ? document
    : null;
}

export class GoogleCalendarEventProvider implements CalendarEventProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly requestTimeoutMs: number;
  private readonly refreshTokens = new Map<string, Promise<
    CalendarProviderResult<{ accessToken: string }>
  >>();
  private readonly accessTokens = new Map<
    string,
    { token: string; expiresAt: number }
  >();

  constructor(private readonly options: GoogleCalendarProviderOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
  }

  private get clientId() {
    return optionalEnv(this.options.clientId ?? process.env.GOOGLE_CLIENT_ID);
  }

  private get clientSecret() {
    return optionalEnv(
      this.options.clientSecret ?? process.env.GOOGLE_CLIENT_SECRET,
    );
  }

  /**
   * Cache tokens by the verified connection snapshot, not only by owner. A
   * reconnect can replace the account and tokens for the same owner; a cached
   * access token from the previous account must never be sent with the new
   * calendar binding.
   */
  private connectionKey(connection: CalendarConnectionRecord) {
    return [
      connection.ownerUserId,
      connection.accountSubject?.trim() ?? "",
      connection.accountEmail?.trim().toLowerCase() ?? "",
      connection.calendarId,
      connection.updatedAt,
    ].join("|");
  }

  private tokenNeedsRefresh(connection: CalendarConnectionRecord) {
    const cached = this.accessTokens.get(this.connectionKey(connection));
    if (cached && cached.expiresAt > this.now().getTime() + 60_000) {
      return false;
    }
    if (!connection.accessTokenEncrypted) return true;
    if (!connection.tokenExpiresAt) return false;
    const expiresAt = new Date(connection.tokenExpiresAt);
    if (Number.isNaN(expiresAt.getTime())) return true;
    return expiresAt.getTime() <= this.now().getTime() + 60_000;
  }

  private refreshAccessToken(
    connection: CalendarConnectionRecord,
  ): Promise<CalendarProviderResult<{ accessToken: string }>> {
    const refreshToken = connection.refreshTokenEncrypted
      ? this.options.decryptToken(connection.refreshTokenEncrypted)
      : null;

    if (!this.clientId || !this.clientSecret || !refreshToken) {
      return Promise.resolve({
        ok: false,
        error: {
          kind: "authorization",
          message:
            "Google Calendar needs to be reconnected before sync can continue.",
        },
      });
    }

    const key = this.connectionKey(connection);
    const cached = this.refreshTokens.get(key);
    if (cached) return cached;

    const refresh = (async (): Promise<
      CalendarProviderResult<{ accessToken: string }>
    > => {
      const response = await this.fetchImpl("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.clientId as string,
          client_secret: this.clientSecret as string,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as GoogleTokenResponse;

      if (!response.ok || !payload.access_token) {
        const failure = classifyGoogleFailure({
          status: response.status,
          message:
            payload.error_description ??
            payload.error ??
            "Google Calendar token refresh failed.",
        });
        return {
          ok: false,
          error:
            payload.error === "invalid_grant"
              ? {
                  kind: "authorization",
                  message:
                    "Google Calendar authorization was revoked. Reconnect Google Calendar.",
                }
              : failure,
        };
      }

      const credentials: RefreshedCalendarCredentials = {
        accessTokenEncrypted: this.options.encryptToken(payload.access_token),
        tokenExpiresAt: payload.expires_in
          ? new Date(
              this.now().getTime() + Math.max(0, payload.expires_in) * 1000,
            ).toISOString()
          : null,
        ...(payload.refresh_token
          ? {
              refreshTokenEncrypted: this.options.encryptToken(
                payload.refresh_token,
              ),
            }
          : {}),
      };

      this.accessTokens.set(key, {
        token: payload.access_token,
        expiresAt: payload.expires_in
          ? this.now().getTime() + Math.max(0, payload.expires_in) * 1000
          : this.now().getTime() + 45 * 60_000,
      });

      return {
        ok: true,
        value: { accessToken: payload.access_token },
        refreshedCredentials: credentials,
      };
    })();

    this.refreshTokens.set(key, refresh);
    return refresh;
  }

  private async accessToken(connection: CalendarConnectionRecord) {
    const key = this.connectionKey(connection);
    const cached = this.accessTokens.get(key);
    if (cached && cached.expiresAt > this.now().getTime() + 60_000) {
      return { ok: true as const, value: { accessToken: cached.token } };
    }

    if (!this.tokenNeedsRefresh(connection)) {
      const token = connection.accessTokenEncrypted
        ? this.options.decryptToken(connection.accessTokenEncrypted)
        : null;
      if (token) {
        return { ok: true as const, value: { accessToken: token } };
      }
    }

    this.refreshTokens.delete(key);
    return this.refreshAccessToken(connection);
  }

  private async authorizedFetch(
    connection: CalendarConnectionRecord,
    path: string,
    init: RequestInit,
    retryOnAuthorization = true,
  ): Promise<
    | {
        ok: true;
        response: Response;
        refreshedCredentials?: RefreshedCalendarCredentials;
      }
    | { ok: false; error: CalendarProviderFailure }
  > {
    let tokenResult = await this.accessToken(connection);
    if (!tokenResult.ok) return { ok: false, error: tokenResult.error };

    const send = (accessToken: string) =>
      this.fetchImpl(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
          connection.calendarId || "primary",
        )}${path}`,
        {
          ...init,
          headers: {
            ...(init.headers ?? {}),
            authorization: `Bearer ${accessToken}`,
          },
          signal: init.signal ?? AbortSignal.timeout(this.requestTimeoutMs),
        },
      );

    let response = await send(tokenResult.value.accessToken);
    let refreshed = tokenResult.refreshedCredentials;

    if (
      response.status === 401 &&
      retryOnAuthorization &&
      connection.refreshTokenEncrypted
    ) {
      this.refreshTokens.delete(this.connectionKey(connection));
      tokenResult = await this.refreshAccessToken(connection);
      if (!tokenResult.ok) return { ok: false, error: tokenResult.error };
      refreshed = tokenResult.refreshedCredentials ?? refreshed;
      response = await send(tokenResult.value.accessToken);
    }

    return { ok: true, response, refreshedCredentials: refreshed };
  }

  private async failureFromResponse(
    response: Response,
  ): Promise<CalendarProviderFailure> {
    const payload = (await response.json().catch(() => ({}))) as GoogleEventResource;
    return classifyGoogleFailure({
      status: response.status,
      message:
        payload.error?.errors?.[0]?.message ??
        payload.error?.message ??
        "Google Calendar request failed.",
      reason: payload.error?.errors?.[0]?.reason,
      retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after")),
    });
  }

  async listManagedEvents(
    connection: CalendarConnectionRecord,
  ): Promise<
    CalendarProviderResult<{
      complete: boolean;
      events: CalendarEventIndexEntry[];
    }>
  > {
    const events: CalendarEventIndexEntry[] = [];
    let pageToken: string | null = null;
    let pageCount = 0;
    let refreshedCredentials: RefreshedCalendarCredentials | undefined;

    do {
      const params = new URLSearchParams({
        privateExtendedProperty: "source=ega-house",
        showDeleted: "false",
        fields: "items(id,status,extendedProperties),nextPageToken",
        maxResults: "2500",
      });
      if (pageToken) params.set("pageToken", pageToken);

      const result = await this.authorizedFetch(
        connection,
        `/events?${params.toString()}`,
        { method: "GET" },
      );
      if (!result.ok) return result;
      refreshedCredentials =
        result.refreshedCredentials ?? refreshedCredentials;
      if (!result.response.ok) {
        return { ok: false, error: await this.failureFromResponse(result.response) };
      }

      const payload: unknown = await result.response
        .json()
        .catch(() => undefined);
      const page = managedEventPage(payload);
      if (!page) {
        // A successful status with a body we cannot trust is not proof that the
        // listing is empty or complete. Refuse the whole listing so the scan
        // cannot infer removals from it.
        return {
          ok: false,
          error: { kind: "retryable", message: MALFORMED_LISTING_MESSAGE },
        };
      }

      events.push(...page.events);
      pageToken = page.nextPageToken;
      pageCount += 1;
      if (pageCount > 100) {
        return {
          ok: false,
          error: {
            kind: "permanent",
            message: "Google Calendar event listing exceeded the page safety limit.",
          },
        };
      }
    } while (pageToken);

    return {
      ok: true,
      value: { complete: true, events },
      refreshedCredentials,
    };
  }

  async getEvent(
    connection: CalendarConnectionRecord,
    eventId: string,
  ): Promise<CalendarProviderResult<CalendarEventDocument | null>> {
    const result = await this.authorizedFetch(
      connection,
      `/events/${encodeURIComponent(eventId)}`,
      { method: "GET" },
    );
    if (!result.ok) return result;
    if (result.response.status === 404 || result.response.status === 410) {
      return {
        ok: true,
        value: null,
        refreshedCredentials: result.refreshedCredentials,
      };
    }
    if (!result.response.ok) {
      return { ok: false, error: await this.failureFromResponse(result.response) };
    }
    const payload: unknown = await result.response
      .json()
      .catch(() => undefined);
    const document = eventDocument(payload, eventId);
    if (!document) {
      return {
        ok: false,
        error: { kind: "retryable", message: MALFORMED_LOOKUP_MESSAGE },
      };
    }
    return {
      ok: true,
      value: document,
      refreshedCredentials: result.refreshedCredentials,
    };
  }

  async createEvent(
    connection: CalendarConnectionRecord,
    payload: CalendarEventPayload,
  ): Promise<CalendarProviderResult<CalendarEventDocument>> {
    const result = await this.authorizedFetch(connection, "/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(eventBody(payload)),
    });
    if (!result.ok) return result;
    if (!result.response.ok) {
      return { ok: false, error: await this.failureFromResponse(result.response) };
    }
    const resource: unknown = await result.response.json().catch(() => null);
    const document = writtenEvent(resource, payload.eventId, payload);
    if (!document) {
      return {
        ok: false,
        error: {
          kind: "permanent",
          message: "Google Calendar saved an unexpected event representation.",
        },
      };
    }
    return {
      ok: true,
      value: document,
      refreshedCredentials: result.refreshedCredentials,
    };
  }

  async updateEvent(
    connection: CalendarConnectionRecord,
    eventId: string,
    payload: CalendarEventPayload,
  ): Promise<CalendarProviderResult<CalendarEventDocument>> {
    const body = eventBody(payload, true);
    const result = await this.authorizedFetch(
      connection,
      `/events/${encodeURIComponent(eventId)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!result.ok) return result;
    if (result.response.status === 404 || result.response.status === 410) {
      return {
        ok: false,
        error: {
          kind: "not_found",
          message: "Google Calendar event no longer exists.",
        },
      };
    }
    if (!result.response.ok) {
      return { ok: false, error: await this.failureFromResponse(result.response) };
    }
    const resource: unknown = await result.response.json().catch(() => null);
    const document = writtenEvent(resource, eventId, payload);
    if (!document) {
      return {
        ok: false,
        error: {
          kind: "permanent",
          message: "Google Calendar saved an unexpected event representation.",
        },
      };
    }
    return {
      ok: true,
      value: document,
      refreshedCredentials: result.refreshedCredentials,
    };
  }

  async deleteEvent(
    connection: CalendarConnectionRecord,
    eventId: string,
  ): Promise<CalendarProviderResult<{ alreadyRemoved: boolean }>> {
    const result = await this.authorizedFetch(
      connection,
      `/events/${encodeURIComponent(eventId)}`,
      { method: "DELETE" },
    );
    if (!result.ok) return result;
    if (result.response.status === 404 || result.response.status === 410) {
      return {
        ok: true,
        value: { alreadyRemoved: true },
        refreshedCredentials: result.refreshedCredentials,
      };
    }
    if (!result.response.ok) {
      return { ok: false, error: await this.failureFromResponse(result.response) };
    }
    return {
      ok: true,
      value: { alreadyRemoved: false },
      refreshedCredentials: result.refreshedCredentials,
    };
  }
}
