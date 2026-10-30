import type { AuthInfo } from "@modelcontextprotocol/server";

import { isValidMcpPrincipal, type McpPrincipal } from "@/lib/mcp/principal";

export const MCP_AUTHORIZED_SCOPE = "ega.mcp.authorized";

function clonePrincipal(principal: McpPrincipal): McpPrincipal {
  return {
    ...principal,
    permissions: [...principal.permissions],
  };
}

export function createMcpAuthInfo(
  accessToken: string,
  principal: McpPrincipal,
  expiresAt?: number,
): AuthInfo {
  const authInfo: AuthInfo = {
    token: accessToken,
    clientId: principal.oauthClientId,
    scopes: [MCP_AUTHORIZED_SCOPE, ...principal.permissions],
    extra: {
      principal: clonePrincipal(principal),
    },
  };

  if (expiresAt !== undefined) {
    authInfo.expiresAt = expiresAt;
  }

  return authInfo;
}

/**
 * THE single place a principal is accepted out of an AuthInfo.
 *
 * `isValidMcpPrincipal` is the only validator, deliberately: it checks the
 * permission set for set equality with the (profile, version) document, so
 * authorisation, tool discovery and this adapter cannot disagree. It used to be
 * conjoined with a second, weaker structural pre-check in this file, and the two
 * drifted apart - `requireMcpPermission` authorised on the weaker one while
 * discovery used the stronger one, so a principal carrying a permission set
 * outside its profile passed authorisation and then failed discovery. The
 * pre-check is also redundant rather than merely weaker: every one of its
 * conjuncts is implied by `isValidMcpPrincipal` (which requires non-blank
 * identity strings, a known profile and version, and a duplicate-free array
 * equal as a SET to the document, and so already restricts every permission to
 * the declared universe). Keeping two statements of the same rule is how the
 * drift happened, so there is now one.
 */
export function readPrincipalFromAuthInfo(authInfo: AuthInfo): McpPrincipal {
  const principal = authInfo.extra?.principal;
  if (!isValidMcpPrincipal(principal)) {
    throw new Error("Missing EGA MCP principal in auth context.");
  }

  return clonePrincipal(principal);
}
