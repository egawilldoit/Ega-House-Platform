// Factory functions for common agent error responses.
// Returns the response body + HTTP status without importing NextResponse.
// Callers (handlers) wrap the body in NextResponse.json(body, { status }).

import type { AgentErrorResponse } from "@/lib/contracts/agent";

export function forbidden(message?: string): {
  body: AgentErrorResponse;
  status: 403;
} {
  return {
    body: {
      ok: false,
      error: {
        code: "FORBIDDEN",
        message: message ?? "You do not have access to this resource.",
      },
    },
    status: 403,
  };
}

export function notFound(message?: string): {
  body: AgentErrorResponse;
  status: 404;
} {
  return {
    body: {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: message ?? "The requested resource was not found.",
      },
    },
    status: 404,
  };
}

export function invalidRequest(message?: string): {
  body: AgentErrorResponse;
  status: 400;
} {
  return {
    body: {
      ok: false,
      error: {
        code: "INVALID_REQUEST",
        message: message ?? "The request is invalid.",
      },
    },
    status: 400,
  };
}

export function validationError(
  message?: string,
  details?: Record<string, unknown>,
): { body: AgentErrorResponse & { details?: Record<string, unknown> }; status: 422 } {
  return {
    body: {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: message ?? "Validation failed.",
      },
      ...(details ? { details } : {}),
    } as AgentErrorResponse & { details?: Record<string, unknown> },
    status: 422,
  };
}

export function rateLimited(retryAfter: number): {
  body: AgentErrorResponse & { retryAfter: number };
  status: 429;
} {
  return {
    body: {
      ok: false,
      error: {
        code: "RATE_LIMITED",
        message: `Rate limit exceeded. Retry after ${retryAfter} seconds.`,
      },
      retryAfter,
    } as AgentErrorResponse & { retryAfter: number },
    status: 429,
  };
}

export function conflict(message?: string): {
  body: AgentErrorResponse;
  status: 409;
} {
  return {
    body: {
      ok: false,
      error: {
        code: "CONFLICT",
        message: message ?? "The request conflicts with the current state.",
      },
    },
    status: 409,
  };
}
