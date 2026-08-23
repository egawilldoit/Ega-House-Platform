// ── Route Permission Matrix ──
// Every route must be explicitly listed here with its required scope.
// Unknown routes are denied by default.
// Write routes require MOBILE_WRITE_ACTIONS_ENABLED=true at config level.

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'WS';

export interface RoutePermission {
  method: HttpMethod | HttpMethod[];
  path: string;
  requiredScope: string[];
  requiresAuth: boolean;
  description: string;
}

// The routing table — single source of truth for permissions.
// Routes not listed here are denied by default (see isRoutePermitted).
const ROUTE_PERMISSIONS: RoutePermission[] = [
  // Public (no auth)
  { method: 'GET', path: '/health', requiredScope: [], requiresAuth: false, description: 'Liveness probe' },
  { method: 'GET', path: '/ready', requiredScope: [], requiresAuth: false, description: 'Readiness probe' },

  // Hermes status (read-only)
  { method: 'GET', path: '/v1/hermes/status', requiredScope: ['read', 'mobile'], requiresAuth: true, description: 'Hermes gateway health' },
  { method: 'GET', path: '/v1/hermes/capabilities', requiredScope: ['read', 'mobile'], requiresAuth: true, description: 'Hermes capabilities' },
  { method: 'GET', path: '/v1/hermes/models', requiredScope: ['read', 'mobile'], requiresAuth: true, description: 'Available models' },
  { method: 'GET', path: '/v1/hermes/skills', requiredScope: ['read', 'mobile'], requiresAuth: true, description: 'Installed skills' },
  { method: 'GET', path: '/v1/hermes/toolsets', requiredScope: ['read', 'mobile'], requiresAuth: true, description: 'Enabled toolsets' },

  // Sessions (read-only)
  { method: 'GET', path: '/v1/sessions', requiredScope: ['read', 'mobile'], requiresAuth: true, description: 'List sessions' },
  { method: 'GET', path: '/v1/sessions/:sessionId', requiredScope: ['read', 'mobile'], requiresAuth: true, description: 'Get session' },
  { method: 'GET', path: '/v1/sessions/:sessionId/messages', requiredScope: ['read', 'mobile'], requiresAuth: true, description: 'Session messages' },

  // Jobs (read-only)
  { method: 'GET', path: '/v1/jobs', requiredScope: ['read', 'mobile'], requiresAuth: true, description: 'List jobs' },
  { method: 'GET', path: '/v1/jobs/:jobId', requiredScope: ['read', 'mobile'], requiresAuth: true, description: 'Get job' },

  // Mobile-specific (read + write depending on endpoint)
  { method: 'GET', path: '/v1/mobile/alerts', requiredScope: ['read', 'mobile'], requiresAuth: true, description: 'List alerts' },
  { method: 'GET', path: '/v1/mobile/events', requiredScope: ['read', 'mobile'], requiresAuth: true, description: 'WebSocket event stream' },

  // Device management (write — needs explicit scope)
  { method: 'POST', path: '/v1/mobile/devices/register', requiredScope: [], requiresAuth: false, description: 'Register device (uses enrollment code)' },
  { method: 'DELETE', path: '/v1/mobile/devices/:deviceId', requiredScope: ['mobile'], requiresAuth: true, description: 'Deregister device' },

  // Token management (no auth — uses refresh token)
  { method: 'POST', path: '/v1/mobile/token/refresh', requiredScope: [], requiresAuth: false, description: 'Refresh access token' },
];

// Permission check result
export interface PermissionCheck {
  allowed: boolean;
  requiredScope: string[];
  reason?: string;
}

/**
 * Check if a route+method is permitted.
 * Returns `{ allowed: true }` or `{ allowed: false, reason }`.
 */
export function checkRoutePermission(method: string, path: string): PermissionCheck {
  // Normalize: strip query string
  const cleanPath = path.split('?')[0]!;

  // Try exact match first, then pattern match
  for (const entry of ROUTE_PERMISSIONS) {
    const methods = Array.isArray(entry.method) ? entry.method : [entry.method];
    if (!methods.includes(method.toUpperCase() as HttpMethod)) continue;

    if (matchPath(entry.path, cleanPath)) {
      return { allowed: true, requiredScope: entry.requiredScope };
    }
  }

  return {
    allowed: false,
    requiredScope: [],
    reason: `Route ${method} ${cleanPath} is not in the permission matrix`,
  };
}

/**
 * Check if a given scope array satisfies all required scopes.
 */
export function hasRequiredScope(userScope: string[], requiredScope: string[]): boolean {
  if (requiredScope.length === 0) return true;
  return requiredScope.every((s) => userScope.includes(s));
}

/**
 * Simple path matcher: supports :param placeholders.
 * /v1/sessions/:sessionId matches /v1/sessions/abc123
 */
function matchPath(pattern: string, path: string): boolean {
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');

  if (patternParts.length !== pathParts.length) return false;

  for (let i = 0; i < patternParts.length; i++) {
    const pp = patternParts[i]!;
    const p = pathParts[i]!;
    if (pp.startsWith(':')) continue; // param match
    if (pp !== p) return false;
  }

  return true;
}

export function getRoutePermissionByPath(method: string, path: string): RoutePermission | undefined {
  const cleanPath = path.split('?')[0]!;
  for (const entry of ROUTE_PERMISSIONS) {
    const methods = Array.isArray(entry.method) ? entry.method : [entry.method];
    if (!methods.includes(method.toUpperCase() as HttpMethod)) continue;
    if (matchPath(entry.path, cleanPath)) {
      return entry;
    }
  }
  return undefined;
}

export function getRoutePermissionDescription(method: string, path: string): string | undefined {
  const cleanPath = path.split('?')[0]!;
  for (const entry of ROUTE_PERMISSIONS) {
    const methods = Array.isArray(entry.method) ? entry.method : [entry.method];
    if (!methods.includes(method.toUpperCase() as HttpMethod)) continue;
    if (matchPath(entry.path, cleanPath)) {
      return entry.description;
    }
  }
  return undefined;
}
