import { describe, expect, it, vi } from "vitest";

import { createMcpAuthInfo } from "@/lib/mcp/auth-info";
import { getPermissionsForProfile } from "@/lib/mcp/permissions";
import {
  McpNotFoundError,
  createMcpReadToolHandlers,
  type McpReadToolDependencies,
} from "@/lib/mcp/read-tool-handlers";

/**
 * MONEY-06 obligation reads. Bills and subscriptions are the same rows, so a
 * single list tool serves both views; each read requires the explicit
 * personal_ops.read grant and forwards the owner resolved from the token.
 */

const owner = "11111111-1111-4111-8111-111111111111";
const OCCURRENCE_ID = "22222222-2222-4222-8222-222222222222";

const readerPrincipal = {
  ownerUserId: owner,
  oauthClientId: "chatgpt-client",
  grantId: "22222222-2222-4222-8222-222222222222",
  permissionProfile: "workspace_money_reader" as const,
  permissionsVersion: 1,
  permissions: getPermissionsForProfile("workspace_money_reader"),
};
const workspaceOnlyPrincipal = {
  ownerUserId: owner,
  oauthClientId: "chatgpt-client",
  grantId: "22222222-2222-4222-8222-222222222222",
  permissionProfile: "workspace_manager" as const,
  permissionsVersion: 1,
  permissions: getPermissionsForProfile("workspace_manager"),
};

const readerAuth = createMcpAuthInfo("token", readerPrincipal);
const workspaceAuth = createMcpAuthInfo("token", workspaceOnlyPrincipal);

function dependencies(overrides: Partial<McpReadToolDependencies> = {}) {
  return {
    createUserClient: () => ({ marker: "client" }) as never,
    listProjects: vi.fn(),
    listGoals: vi.fn(),
    listTasks: vi.fn(),
    ...overrides,
  } as McpReadToolDependencies;
}

function errorCode(result: { structuredContent?: unknown }) {
  return (result.structuredContent as { error?: { code?: string } } | undefined)
    ?.error?.code;
}

describe("MCP obligation read handlers", () => {
  it("lists obligations for the verified owner with bounded filters", async () => {
    const moneyObligationsList = vi.fn().mockResolvedValue({
      obligations: [{ id: OCCURRENCE_ID, state: "pending" }],
      pagination: { limit: 10, offset: 0, hasMore: false },
      count: 1,
    });
    const handlers = createMcpReadToolHandlers(
      dependencies({ moneyObligationsList }),
    );

    const result = await handlers.moneyObligationsList(readerAuth, {
      kind: "bill",
      state: "pending",
      dueFrom: "2026-11-01",
      dueTo: "2026-11-30",
      limit: 10,
    });

    expect(result.isError).toBeUndefined();
    expect(moneyObligationsList).toHaveBeenCalledWith(
      expect.anything(),
      owner,
      {
        kind: "bill",
        state: "pending",
        dueFrom: "2026-11-01",
        dueTo: "2026-11-30",
        limit: 10,
      },
    );
    const payload = result.structuredContent as {
      ok: boolean;
      obligations: unknown[];
      count: number;
    };
    expect(payload.ok).toBe(true);
    expect(payload.count).toBe(1);
  });

  it("returns NOT_FOUND for an occurrence this owner cannot see", async () => {
    const moneyObligationGet = vi
      .fn()
      .mockRejectedValue(
        new McpNotFoundError("Obligation was not found or is no longer available."),
      );
    const handlers = createMcpReadToolHandlers(
      dependencies({ moneyObligationGet }),
    );

    const result = await handlers.moneyObligationGet(readerAuth, {
      obligationId: OCCURRENCE_ID,
    });

    expect(result.isError).toBe(true);
    expect(errorCode(result)).toBe("NOT_FOUND");
  });

  it("lists templates with the archived flag", async () => {
    const moneyObligationTemplatesList = vi.fn().mockResolvedValue({
      templates: [],
      count: 0,
    });
    const handlers = createMcpReadToolHandlers(
      dependencies({ moneyObligationTemplatesList }),
    );

    const result = await handlers.moneyObligationTemplatesList(readerAuth, {
      kind: "subscription",
      includeArchived: true,
    });

    expect(result.isError).toBeUndefined();
    expect(moneyObligationTemplatesList).toHaveBeenCalledWith(
      expect.anything(),
      owner,
      { kind: "subscription", includeArchived: true },
    );
  });

  it("denies obligation reads when the grant lacks personal_ops.read", async () => {
    const moneyObligationsList = vi.fn();
    const moneyObligationGet = vi.fn();
    const moneyObligationTemplatesList = vi.fn();
    const handlers = createMcpReadToolHandlers(
      dependencies({
        moneyObligationsList,
        moneyObligationGet,
        moneyObligationTemplatesList,
      }),
    );

    const list = await handlers.moneyObligationsList(workspaceAuth, {});
    const get = await handlers.moneyObligationGet(workspaceAuth, {
      obligationId: OCCURRENCE_ID,
    });
    const templates = await handlers.moneyObligationTemplatesList(
      workspaceAuth,
      {},
    );

    for (const result of [list, get, templates]) {
      expect(result.isError).toBe(true);
      expect(errorCode(result)).toBe("PERMISSION_DENIED");
    }
    expect(moneyObligationsList).not.toHaveBeenCalled();
    expect(moneyObligationGet).not.toHaveBeenCalled();
    expect(moneyObligationTemplatesList).not.toHaveBeenCalled();
  });
});
