import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

import { readPrincipalFromAuthInfo } from "@/lib/mcp/auth-info";
import {
  hasMcpPermission,
  type McpPermission,
} from "@/lib/mcp/permissions";
import type { McpPrincipal } from "@/lib/mcp/principal";

export type McpToolAuthorizationErrorCode =
  | "UNAUTHENTICATED"
  | "PERMISSION_DENIED";

export class McpToolAuthorizationError extends Error {
  readonly code: McpToolAuthorizationErrorCode;

  constructor(code: McpToolAuthorizationErrorCode, message: string) {
    super(message);
    this.name = "McpToolAuthorizationError";
    this.code = code;
  }
}

export function requireMcpPermission(
  authInfo: AuthInfo | undefined,
  permission: McpPermission,
): McpPrincipal {
  if (!authInfo) {
    throw new McpToolAuthorizationError(
      "UNAUTHENTICATED",
      "Authentication is required for this tool.",
    );
  }

  let principal: McpPrincipal;
  try {
    principal = readPrincipalFromAuthInfo(authInfo);
  } catch {
    throw new McpToolAuthorizationError(
      "UNAUTHENTICATED",
      "Authentication is required for this tool.",
    );
  }

  if (!hasMcpPermission(principal.permissions, permission)) {
    throw new McpToolAuthorizationError(
      "PERMISSION_DENIED",
      `The active EGA grant does not allow ${permission}.`,
    );
  }

  return principal;
}
