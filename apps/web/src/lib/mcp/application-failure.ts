import type { ApplicationErrorCode } from "@ega/application";

/**
 * The MCP write transport's single translation of a canonical
 * `ApplicationResult` failure class onto a protocol error code, and the single
 * statement of which protocol codes are a PERMANENT outcome of a mutation.
 *
 * WHY THIS IS CANONICAL POLICY AND NOT A PER-MODULE INVENTION. Every write
 * module used to flatten `result.errorMessage` into one code, so the canonical
 * class in `ApplicationResult.code` never reached the transport and a transient
 * PostgREST/RLS hiccup was indistinguishable from a bad argument. The exclusive
 * execution wrapper turns a permanent failure into `p_final = true`, which
 * `0058` records as FAILED_FINAL, and FAILED_FINAL REPLAYS `result_payload` -
 * so one frozen error also made that operationId permanently unusable. Carrying
 * the class through is therefore a correctness requirement of the idempotency
 * ledger, not a wording preference.
 *
 * `unknown` is the dependency class: the use case could not reach its own
 * dependency, so the outcome is unknown and MUST stay retryable.
 */
export type McpApplicationFailureCode =
  | "INVALID_ARGUMENT"
  | "NOT_FOUND"
  | "CONFLICT"
  | "DEPENDENCY_UNAVAILABLE";

export type McpApplicationFailurePayload = {
  code: McpApplicationFailureCode;
  message: string;
};

/**
 * Matches the wording already used by the transport's own thrown-error mapping
 * and by the timer module, so a dependency failure reads identically whichever
 * path produced it and no internal detail is echoed back to the caller.
 */
export const DEPENDENCY_UNAVAILABLE_MESSAGE = "EGA House data is temporarily unavailable.";

export function mcpErrorCodeForApplicationFailure(
  code: ApplicationErrorCode | undefined,
): McpApplicationFailureCode {
  switch (code) {
    case "validation":
      return "INVALID_ARGUMENT";
    case "notFound":
      return "NOT_FOUND";
    case "conflict":
      return "CONFLICT";
    case "unknown":
      return "DEPENDENCY_UNAVAILABLE";
    default:
      // No class was asserted. A use case that rejects its own input without
      // naming a class is the validation case, and validation is permanent by
      // definition: retrying the same arguments cannot change the answer.
      return "INVALID_ARGUMENT";
  }
}

export function mcpApplicationFailurePayload(
  errorMessage: string,
  code?: ApplicationErrorCode,
): McpApplicationFailurePayload {
  return {
    code: mcpErrorCodeForApplicationFailure(code),
    message: code === "unknown" ? DEPENDENCY_UNAVAILABLE_MESSAGE : errorMessage,
  };
}

/**
 * Protocol codes whose outcome cannot change on a retry of the same
 * operationId, so the receipt is kept as FAILED_FINAL audit evidence. This is
 * the pre-existing set, unchanged: the repair here is the CLASSIFICATION of a
 * failure, not the permanence rule. Widening or narrowing it is a separate
 * decision.
 *
 * DEPENDENCY_UNAVAILABLE is deliberately absent: it is the class a transient
 * failure must land in, and `0058` re-claims a FAILED_RETRYABLE receipt and
 * re-attempts the mutation. NOT_FOUND is absent for the same reason - a stop
 * that found no open session can succeed on a later attempt. INTERNAL_ERROR,
 * RATE_LIMITED and absent/unknown codes also fail retryably, which keeps a
 * ledger failure or an unclassified error from burning an operationId.
 */
const PERMANENT_MCP_ERROR_CODES: ReadonlySet<string> = new Set([
  "INVALID_ARGUMENT",
  "PERMISSION_DENIED",
  "CONFLICT",
  "FAILED_FINAL",
  "CONFIRMATION_DECLINED",
  "WRITES_DISABLED",
]);

export function isPermanentMcpFailureCode(code: string | undefined): boolean {
  return code !== undefined && PERMANENT_MCP_ERROR_CODES.has(code);
}