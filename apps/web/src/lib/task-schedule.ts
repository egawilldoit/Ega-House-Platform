/**
 * Web-facing re-export of the canonical scheduled-block validator. The rule
 * lives in `@ega/domain` so Web, Hono and MCP share one schedule authority.
 */
export { normalizeTaskScheduleInput } from "@ega/domain";
