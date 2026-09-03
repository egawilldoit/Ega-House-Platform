/**
 * Error envelope and result mapping for the EGA House HTTP transport.
 *
 * Resource routes answer errors with `{ error: { code, message } }` using the
 * transport codes below. Auth routes use the mobile contract vocabulary
 * (INVALID_CREDENTIALS, SESSION_EXPIRED, VALIDATION_ERROR, ...), which this
 * module maps onto the closest transport code while preserving status and
 * message.
 */

export type ApiErrorCode = "UNAUTHENTICATED" | "VALIDATION" | "NOT_FOUND" | "CONFLICT" | "INTERNAL";

export type ApiErrorPayload = {
  code: ApiErrorCode;
  message: string;
  status: number;
};

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiErrorPayload };

const KNOWN_CODES: ReadonlySet<string> = new Set([
  "UNAUTHENTICATED",
  "VALIDATION",
  "NOT_FOUND",
  "CONFLICT",
  "INTERNAL",
]);

/** Mobile contract auth codes mapped onto the closest transport code. */
const MOBILE_CODE_ALIASES: Readonly<Record<string, ApiErrorCode>> = {
  INVALID_CREDENTIALS: "UNAUTHENTICATED",
  SESSION_EXPIRED: "UNAUTHENTICATED",
  VALIDATION_ERROR: "VALIDATION",
  INVALID_REQUEST: "VALIDATION",
};

const DEFAULT_MESSAGES: Record<ApiErrorCode, string> = {
  UNAUTHENTICATED: "Authentication required.",
  VALIDATION: "Request was invalid.",
  NOT_FOUND: "Resource not found.",
  CONFLICT: "The request conflicts with current state.",
  INTERNAL: "Internal server error.",
};

/** Code implied by the HTTP status when the body carries no usable envelope. */
function codeForStatus(status: number): ApiErrorCode {
  if (status === 401) return "UNAUTHENTICATED";
  if (status === 400) return "VALIDATION";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  return "INTERNAL";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse a server response body into a typed error payload.
 *
 * Prefers the `{ error: { code, message } }` envelope when present; falls
 * back to the HTTP status when the body is missing or malformed. Unknown
 * envelope codes are normalized to INTERNAL so callers only ever see the
 * five documented codes.
 */
export function parseErrorEnvelope(
  body: unknown,
  status: number,
): ApiErrorPayload {
  if (isRecord(body) && isRecord(body.error)) {
    const { code, message } = body.error;
    let normalizedCode: ApiErrorCode = "INTERNAL";
    if (typeof code === "string") {
      if (KNOWN_CODES.has(code)) {
        normalizedCode = code as ApiErrorCode;
      } else if (MOBILE_CODE_ALIASES[code]) {
        normalizedCode = MOBILE_CODE_ALIASES[code];
      }
    }
    return {
      code: normalizedCode,
      message:
        typeof message === "string" && message.length > 0
          ? message
          : DEFAULT_MESSAGES[normalizedCode],
      status,
    };
  }

  const fallbackCode = codeForStatus(status);
  return {
    code: fallbackCode,
    message: DEFAULT_MESSAGES[fallbackCode],
    status,
  };
}

/** Result for mutation endpoints whose success body is `{ ok: true }`. */
export type OkResponse = { ok: true };

export function okResult<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}

export function errorResult(payload: ApiErrorPayload): ApiResult<never> {
  return { ok: false, error: payload };
}
