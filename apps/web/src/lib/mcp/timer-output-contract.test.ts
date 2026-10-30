import type { McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";

import { createMcpAuthInfo } from "@/lib/mcp/auth-info";
import { getPermissionsForProfile } from "@/lib/mcp/permissions";
import type { McpPrincipal } from "@/lib/mcp/principal";
import { registerMcpReadTools } from "@/lib/mcp/server";

// `isValidMcpPrincipal` requires the stored document to equal the profile's own
// (profile, version) document exactly, so the fixture carries the real one rather
// than a hand-written subset.
const PRINCIPAL: McpPrincipal = {
  ownerUserId: "00000000-0000-0000-0000-000000000001",
  oauthClientId: "hermes-client",
  grantId: "10000000-0000-0000-0000-000000000001",
  permissionProfile: "workspace_manager",
  permissionsVersion: 1,
  permissions: getPermissionsForProfile("workspace_manager", 1),
};

const AUTH_INFO = createMcpAuthInfo("test-bearer", PRINCIPAL);

/**
 * WHY THIS FILE EXISTS. `ega_list_timer_sessions` declares
 * `timerSessionsOutputSchema` as a STRICT object, and the SDK validates a tool's
 * declared output against what the handler returns. The repository maps rows with
 * `mapSession`, which emits SIX fields - `durationSeconds` and `taskTitle`
 * included - while the schema declared four. A strict object rejects unknown
 * keys, so every real timer result failed output validation: the capability was
 * advertised and the tool answered, but the answer could not be delivered.
 *
 * These tests pin the schema to the CANONICAL record shape rather than to
 * whatever the schema happened to say, because the two had drifted and only the
 * domain type is authoritative. `.passthrough()` would have hidden the drift
 * instead of closing it, so strictness is asserted explicitly below: a stray key
 * must still be refused.
 */

type Registration = {
  name: string;
  config: Record<string, unknown>;
  handler: (...args: unknown[]) => unknown;
};

function registrationFor(name: string): Registration {
  const registrations: Registration[] = [];
  const server = {
    registerTool: vi.fn(
      (
        toolName: string,
        config: Record<string, unknown>,
        handler: (...args: unknown[]) => unknown,
      ) => {
        registrations.push({ name: toolName, config, handler });
      },
    ),
  } as unknown as McpServer;

  registerMcpReadTools(server, {
    getCapabilities: vi.fn(),
    listProjects: vi.fn(),
    listGoals: vi.fn(),
    listTasks: vi.fn(),
    getTask: vi.fn(),
    getTodayPlan: vi.fn(),
    listTimerSessions: vi.fn(),
  } as never);

  const found = registrations.find((entry) => entry.name === name);
  if (!found) throw new Error(`${name} was not registered`);
  return found;
}

function timerOutputSchema(): z.ZodTypeAny {
  return registrationFor("ega_list_timer_sessions").config.outputSchema as z.ZodTypeAny;
}

/**
 * A session exactly as `mapSession` in packages/data-access/src/timer/repository.ts
 * produces one. This is the runtime DTO; the schema must accept it verbatim.
 */
function canonicalSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    taskId: "22222222-2222-4222-8222-222222222222",
    startedAt: "2026-10-06T10:00:00.000Z",
    endedAt: null,
    durationSeconds: null,
    taskTitle: "Ship the thing",
    ...overrides,
  };
}

describe("ega_list_timer_sessions output contract", () => {
  it("accepts the canonical record, including durationSeconds and taskTitle", () => {
    const parsed = timerOutputSchema().parse({
      ok: true,
      sessions: [canonicalSession()],
      count: 1,
    });

    expect(parsed).toMatchObject({
      ok: true,
      count: 1,
      sessions: [
        {
          durationSeconds: null,
          taskTitle: "Ship the thing",
          endedAt: null,
        },
      ],
    });
  });

  it("accepts non-null durationSeconds and a null taskTitle on a closed session", () => {
    const parsed = timerOutputSchema().parse({
      ok: true,
      sessions: [
        canonicalSession({
          endedAt: "2026-10-06T11:30:00.000Z",
          durationSeconds: 5400,
          taskTitle: null,
        }),
      ],
      count: 1,
    });

    expect(parsed).toMatchObject({
      sessions: [{ durationSeconds: 5400, taskTitle: null }],
    });
  });

  it("accepts a zero duration and an empty title rather than coercing them", () => {
    const parsed = timerOutputSchema().parse({
      ok: true,
      sessions: [canonicalSession({ durationSeconds: 0, taskTitle: "" })],
      count: 1,
    });

    expect(parsed).toMatchObject({ sessions: [{ durationSeconds: 0, taskTitle: "" }] });
  });

  it("accepts an empty session list", () => {
    expect(timerOutputSchema().parse({ ok: true, sessions: [], count: 0 })).toEqual({
      ok: true,
      sessions: [],
      count: 0,
    });
  });

  it("STILL rejects an unknown field, so the drift cannot recur silently", () => {
    // This is the assertion that distinguishes a correct fix from `.passthrough()`.
    // A permissive schema would accept this and the contract would drift again
    // without anything failing.
    const schema = timerOutputSchema();
    expect(
      schema.safeParse({
        ok: true,
        sessions: [canonicalSession({ somethingNew: true })],
        count: 1,
      }).success,
    ).toBe(false);
  });

  it("STILL rejects an unknown top-level field", () => {
    expect(
      timerOutputSchema().safeParse({ ok: true, sessions: [], count: 0, extra: 1 }).success,
    ).toBe(false);
  });

  it("rejects a session missing a canonical field rather than defaulting it", () => {
    // Every canonical field is required, so a repository that stops emitting one
    // fails loudly instead of the client receiving an absent key.
    const { durationSeconds: _omitted, ...withoutDuration } = canonicalSession();
    expect(
      timerOutputSchema().safeParse({ ok: true, sessions: [withoutDuration], count: 1 })
        .success,
    ).toBe(false);
  });

  it("agrees with the canonical domain type on the exact key set", () => {
    // Read the schema's own shape rather than trusting the cases above, so a
    // future field added to one side only is caught here.
    const schema = timerOutputSchema();
    const sessionShape = (schema as unknown as {
      shape: Record<string, z.ZodTypeAny>;
    }).shape.sessions;
    const sessionObject = (sessionShape as unknown as {
      _def: { innerType: z.ZodTypeAny };
      element: z.ZodTypeAny;
    })._def?.innerType ?? (sessionShape as unknown as { element: z.ZodTypeAny }).element;
    const declared = Object.keys(
      (sessionObject as unknown as { shape: Record<string, unknown> }).shape,
    ).sort();

    expect(declared).toEqual(
      ["durationSeconds", "endedAt", "id", "startedAt", "taskId", "taskTitle"].sort(),
    );
  });
});

describe("ega_list_timer_sessions session assembly", () => {
  it("does not return the open session twice when includeClosed is set", async () => {
    // `listOpenSessions` filters `ended_at IS NULL` and takes 1; `listRecentSessions`
    // has NO such filter. So the open session is in BOTH lists, and concatenating them
    // yields it twice. Driven through the real handler with a fake repository so the
    // assembly code itself is under test, not a reimplementation of it.
    const open = canonicalSession({ id: "aaaaaaaa-0000-4000-8000-000000000001" });
    const closed = canonicalSession({
      id: "bbbbbbbb-0000-4000-8000-000000000002",
      endedAt: "2026-10-06T09:00:00.000Z",
      durationSeconds: 600,
      taskTitle: "Older",
    });

    const { createMcpReadToolHandlers } = await import("@/lib/mcp/read-tool-handlers");
    const handlers = createMcpReadToolHandlers({
      createUserClient: vi.fn().mockReturnValue({}),
    } as never);

    // The handler constructs the repository itself, so the fake is installed on the
    // prototype the real repository class exposes and the handler's own construction
    // path still runs.
    const { SupabaseTimerSessionRepository } = await import("@ega/data-access");
    const proto = SupabaseTimerSessionRepository.prototype as unknown as Record<string, unknown>;
    const saved = {
      open: proto.listOpenSessions,
      recent: proto.listRecentSessions,
    };
    proto.listOpenSessions = vi.fn().mockResolvedValue({ ok: true, value: [open] });
    proto.listRecentSessions = vi.fn().mockResolvedValue({ ok: true, value: [open, closed] });

    try {
      const result = (await handlers.listTimerSessions(
        AUTH_INFO,
        { includeClosed: true },
      )) as { structuredContent?: { sessions?: Array<{ id: string }> } };

      const sessions = result.structuredContent?.sessions ?? [];
      expect(sessions.map((s) => s.id)).toEqual([open.id, closed.id]);
    } finally {
      proto.listOpenSessions = saved.open;
      proto.listRecentSessions = saved.recent;
    }
  });

  it("returns only the open session when includeClosed is not set", async () => {
    const open = canonicalSession({ id: "aaaaaaaa-0000-4000-8000-000000000001" });
    const { createMcpReadToolHandlers } = await import("@/lib/mcp/read-tool-handlers");
    const handlers = createMcpReadToolHandlers({
      createUserClient: vi.fn().mockReturnValue({}),
    } as never);

    const { SupabaseTimerSessionRepository } = await import("@ega/data-access");
    const proto = SupabaseTimerSessionRepository.prototype as unknown as Record<string, unknown>;
    // Both methods are stubbed even though `includeClosed` is falsy and so
    // `listRecentSessions` is never reached. Stubbing the pair and restoring
    // the pair keeps this test symmetric with the `includeClosed` test above: if
    // either restore were ever skipped, the sibling test would fail loudly
    // instead of silently inheriting a leaked prototype patch.
    const saved = { open: proto.listOpenSessions, recent: proto.listRecentSessions };
    proto.listOpenSessions = vi.fn().mockResolvedValue({ ok: true, value: [open] });
    proto.listRecentSessions = vi.fn().mockResolvedValue({ ok: true, value: [] });

    try {
      const result = (await handlers.listTimerSessions(AUTH_INFO, {})) as {
        structuredContent?: { sessions?: Array<{ id: string }>; count?: number };
      };
      expect(result.structuredContent?.sessions?.map((s) => s.id)).toEqual([open.id]);
      expect(result.structuredContent?.count).toBe(1);
    } finally {
      proto.listOpenSessions = saved.open;
      proto.listRecentSessions = saved.recent;
    }
  });
});