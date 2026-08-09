export type ProtectedResourceMetadata = {
  resource: string;
  authorization_servers: string[];
  bearer_methods_supported: ["header"];
  resource_documentation?: string;
};

type ProtectedResourceMetadataInput = {
  resource: string;
  authorizationServer: string;
  resourceDocumentation?: string;
};

function parseSecureUrl(value: string): URL {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new Error("MCP resource URL must use HTTPS or localhost HTTP.");
  }

  const isLocalhost =
    parsed.hostname === "localhost"
    || parsed.hostname === "127.0.0.1"
    || parsed.hostname === "::1"
    || parsed.hostname.endsWith(".localhost");

  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocalhost)) {
    throw new Error("MCP resource URL must use HTTPS or localhost HTTP.");
  }

  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("MCP resource URL must use HTTPS or localhost HTTP.");
  }

  return parsed;
}

function withoutTrailingSlash(url: URL): string {
  const normalizedPath = url.pathname.replace(/\/+$/, "");
  url.pathname = normalizedPath || "/";
  return url.toString().replace(/\/$/, "");
}

export function normalizeMcpResourceUrl(value: string): string {
  return withoutTrailingSlash(parseSecureUrl(value));
}

export function normalizeSupabaseAuthorizationServer(value: string): string {
  const parsed = parseSecureUrl(value);
  const normalizedBase = withoutTrailingSlash(parsed);

  if (normalizedBase.endsWith("/auth/v1")) {
    return normalizedBase;
  }

  return `${normalizedBase}/auth/v1`;
}

export function buildProtectedResourceMetadata(
  input: ProtectedResourceMetadataInput,
): ProtectedResourceMetadata {
  const metadata: ProtectedResourceMetadata = {
    resource: normalizeMcpResourceUrl(input.resource),
    authorization_servers: [
      normalizeSupabaseAuthorizationServer(input.authorizationServer),
    ],
    bearer_methods_supported: ["header"],
  };

  if (input.resourceDocumentation) {
    metadata.resource_documentation = normalizeMcpResourceUrl(
      input.resourceDocumentation,
    );
  }

  return metadata;
}
