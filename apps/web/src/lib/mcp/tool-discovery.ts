import {
  MCP_CAPABILITIES,
  getAllCapabilityNames,
  isCapabilityRegistered,
} from "@/lib/mcp/capability-registry";
import type { McpPermission } from "@/lib/mcp/permissions";

/**
 * Tool discovery is derived entirely from the canonical capability registry.
 * This module keeps only the two call sites that used to own a hand-maintained
 * list working, so there is no second place to update when a capability is
 * added, renamed or re-gated.
 */
export function filterToolsByPermissions(
  permissions: readonly McpPermission[],
  writesEnabled: boolean,
): string[] {
  return MCP_CAPABILITIES.filter((capability) =>
    isCapabilityRegistered(capability, permissions, writesEnabled),
  ).map((capability) => capability.name);
}

export function getAllToolNames(): string[] {
  return getAllCapabilityNames();
}
