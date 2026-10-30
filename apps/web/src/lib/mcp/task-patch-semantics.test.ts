import { describe, expect, it, vi } from "vitest";
import type { AuthInfo } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createMcpAuthInfo } from "@/lib/mcp/auth-info";
import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import { canonicalMutationFingerprint } from "@/lib/mcp/mutation-idempotency";
import { getPermissionsForProfile } from "@/lib/mcp/permissions";
import type { McpPrincipal } from "@/lib/mcp/principal";

/**
 * WHY THIS FILE EXISTS. `ega_update_task` is a PATCH tool: an OMITTED optional
 * field preserves the stored value, an EXPLICIT null clears it. The transport used
 * `input.x ?? null` in both the object handed to the write module and the semantic
 * object hashed into the mutation fingerprint, which broke that contract twice over:
 *
 *   1. an omitted field arrived as an explicit null, so `updateTaskService` - which
 *      guards each field with `if (input.x !== undefined)` - CLEARED
 *      description / blockedReason / dueDate / estimateMinutes instead of leaving
 *      them alone. A partial update silently wiped untouched columns.
 *   2. omission and explicit null hashed IDENTICALLY, because both became null, so
 *      a retry that omitted a field after one that cleared it replayed the stored
 *      result instead of applying the new intent.
 *
 * These tests drive the REAL handler and the REAL write module, with the repository
 * replaced by an in-memory task. Nothing here reimplements the mapping under test -
 * a reimplementation would pass while the transport stayed broken.
 */

const PRINCIPAL: McpPrincipal = {
  ownerUserId: "00000000-0000-0000-0000-0000000000aa",
  oauthClientId: "hermes-client",
  grantId: "10000000-0000-0000-0000-0000000000bb",
  permissionProfile: "workspace_manager",
  permissionsVersion: 1,
  permissions: getPermissionsForProfile("workspace_manager", 1),
};
const AUTH_INFO = createMcpAuthInfo("bearer-token", PRINCIPAL) as AuthInfo;

const OP = "44444444-4444-4444-8444-444444444444";
const TASK_ID = "33333333-3333-4333-8333-333333333333";

type StoredTask = {
  id: string;
  title: string;
  description: string | null;
  blockedReason: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
  estimateMinutes: number | null;
};

function freshTask(): StoredTask {
  return {
    id: TASK_ID,
    title: "Original title",
    description: "KEEP ME",
    blockedReason: null,
    status: "todo",
    priority: "medium",
    dueDate: "2026-12-01",
    estimateMinutes: 90,
  };
}

/**
 * An in-memory stand-in for `SupabaseTasksRepository.updateTask`.
 *
 * The point is that it applies the SAME presence rule the real repository does -
 * only assign a field whose value is not `undefined` - so a transport that turns an
 * omission into an explicit null is observable here as a cleared column.
 *
 * The discriminator is `value === undefined`, mirroring
 * `SupabaseTasksRepository.updateTask` (packages/data-access/src/tasks/repository.ts)
 * which builds its Supabase payload with `if (input.x !== undefined) payload.x = input.x`.
 * Matching that rule exactly matters: a key that EXISTS with value `undefined` must
 * leave the column untouched here too, otherwise this stand-in would clear a column the
 * real repository preserves and report a false alarm the moment the upstream guard is
 * refactored. Note the asymmetry is deliberate - the real repository keys on the VALUE,
 * not on key presence.
 */
function memoryRepository(initial: StoredTask) {
  const row = { ...initial };
  const payloads: Array<Record<string, unknown>> = [];
  const updateTask = vi.fn(
    async (_actor: unknown, update: Record<string, unknown>) => {
      payloads.push({ ...update });
      for (const [key, value] of Object.entries(update)) {
        if (key === "taskId") continue;
        if (value === undefined) continue;
        (row as unknown as Record<string, unknown>)[key] = value;
      }
      return { ok: true, value: { ...row } };
    },
  );
  return { row, updateTask, payloads };
}

/** Receipt client: grants every claim so the handler always reaches the write. */
function grantingClient() {
  const claims: Array<{ argsHash: string }> = [];
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    if (fn === "mcp_claim_mutation_receipt") {
      claims.push({ argsHash: String(args.p_args_hash) });
      return {
        data: [{ claim_outcome: "CLAIM_GRANTED", claim_token: "token-1", existing_result: null }],
        error: null,
      };
    }
    return { data: null, error: null };
  });
  return { client: { rpc } as unknown as SupabaseClient<McpDatabase>, claims };
}

/**
 * Builds the real `write-tool-handlers` over the real `write/tasks` module, with only
 * the persistence boundary replaced. Everything between the MCP argument object and
 * the repository payload is the shipped code path.
 */
async function harness(initial: StoredTask) {
  const { row, updateTask, payloads } = memoryRepository(initial);
  const { client, claims } = grantingClient();

  // Each harness needs its OWN module graph. `vi.doMock` only affects modules
  // evaluated AFTER it, and `write-tool-handlers` is cached after the first import -
  // so without the reset every test would share the first test's mocked repository and
  // only the first test's `row` would ever be written. The reset is what makes the
  // per-test in-memory task real rather than a shared singleton.
  vi.resetModules();

  vi.doMock("@ega/data-access", () => ({
    SupabaseTasksRepository: class {
      updateTask = updateTask;
      getTask = vi.fn(async () => ({ ok: true, value: { ...row } }));
      createTask = vi.fn();
      setTaskArchived = vi.fn();
      setFocusRank = vi.fn();
      createReminder = vi.fn();
      cancelReminder = vi.fn();
      listRecurrences = vi.fn();
    },
    SupabaseTimerSessionRepository: class {},
    SupabaseTodayReadPort: class {},
  }));

  const { createMcpWriteToolHandlers } = await import("@/lib/mcp/write-tool-handlers");
  const handlers = createMcpWriteToolHandlers({ createUserClient: () => client }, true);
  return { handlers, row, claims, payloads };
}

function structured(result: unknown): Record<string, unknown> {
  return (result as { structuredContent?: Record<string, unknown> })?.structuredContent ?? {};
}

describe("ega_update_task PATCH semantics: an omitted field preserves the stored value", () => {
  it("leaves description, dueDate and estimateMinutes untouched when they are not sent", async () => {
    const { handlers, row } = await harness(freshTask());

    // Only title, status and priority - a genuine partial update.
    const result = await handlers.updateTask(AUTH_INFO, {
      taskId: TASK_ID,
      title: "Renamed",
      status: "in_progress",
      priority: "high",
      operationId: OP,
    });

    expect(structured(result)).toMatchObject({ ok: true });
    expect(row.title).toBe("Renamed");
    expect(row.status).toBe("in_progress");
    expect(row.priority).toBe("high");

    // The three fields the caller never mentioned must survive verbatim.
    expect(row.description).toBe("KEEP ME");
    expect(row.dueDate).toBe("2026-12-01");
    expect(row.estimateMinutes).toBe(90);
  });

  it("sends an omitted field to the repository as ABSENT, not as null", async () => {
    // The strongest form of the claim: assert on the payload that actually reaches the
    // persistence boundary. A storage-level assertion alone could be satisfied by a
    // repository that happened to ignore nulls, which would not prove the transport
    // preserved the omission.
    const { handlers, payloads, row } = await harness(freshTask());

    await handlers.updateTask(AUTH_INFO, {
      taskId: TASK_ID,
      title: "Renamed again",
      operationId: OP,
    });

    expect(payloads).toHaveLength(1);
    const sent = payloads[0];
    expect(sent).toHaveProperty("title", "Renamed again");
    for (const field of ["description", "blockedReason", "dueDate", "estimateMinutes"]) {
      expect(
        Object.prototype.hasOwnProperty.call(sent, field),
        `${field} must be absent from the update payload, not present-and-null`,
      ).toBe(false);
    }
    // And the durable effect agrees.
    expect(row.description).toBe("KEEP ME");
  });

  it("does not clear blockedReason when it is omitted on an otherwise unrelated edit", async () => {
    const { handlers, row } = await harness({
      ...freshTask(),
      status: "blocked",
      blockedReason: "Waiting on the vendor",
    });

    await handlers.updateTask(AUTH_INFO, {
      taskId: TASK_ID,
      priority: "low",
      operationId: OP,
    });

    expect(row.priority).toBe("low");
    expect(row.blockedReason).toBe("Waiting on the vendor");
  });
});

describe("ega_update_task PATCH semantics: an explicit null clears the stored value", () => {
  it("clears description, dueDate and estimateMinutes when they are explicitly null", async () => {
    const { handlers, row } = await harness(freshTask());

    const result = await handlers.updateTask(AUTH_INFO, {
      taskId: TASK_ID,
      title: "Renamed",
      description: null,
      dueDate: null,
      estimateMinutes: null,
      operationId: OP,
    });

    expect(structured(result)).toMatchObject({ ok: true });
    expect(row.title).toBe("Renamed");
    expect(row.description).toBeNull();
    expect(row.dueDate).toBeNull();
    expect(row.estimateMinutes).toBeNull();
  });

  it("clears blockedReason when it is explicitly null", async () => {
    const { handlers, row } = await harness({
      ...freshTask(),
      status: "blocked",
      blockedReason: "Waiting on the vendor",
    });

    await handlers.updateTask(AUTH_INFO, {
      taskId: TASK_ID,
      status: "in_progress",
      blockedReason: null,
      operationId: OP,
    });

    expect(row.status).toBe("in_progress");
    expect(row.blockedReason).toBeNull();
  });

  it("omission and explicit null are genuinely different mutations end to end", async () => {
    // The pair that matters: same operationId is not reused here, but both must
    // leave the row in DIFFERENT states, and they must not be conflated.
    const omitted = await harness(freshTask());
    await omitted.handlers.updateTask(AUTH_INFO, {
      taskId: TASK_ID,
      title: "Same title",
      operationId: OP,
    });

    const cleared = await harness(freshTask());
    await cleared.handlers.updateTask(AUTH_INFO, {
      taskId: TASK_ID,
      title: "Same title",
      description: null,
      operationId: OP,
    });

    expect(omitted.row.description).toBe("KEEP ME");
    expect(cleared.row.description).toBeNull();
  });
});

describe("ega_update_task fingerprint distinguishes omission from an explicit clear", () => {
  /** Every nullable PATCH field on the tool. */
  const NULLABLE_FIELDS = [
    "description",
    "blockedReason",
    "dueDate",
    "estimateMinutes",
  ] as const;

  it("produces a different fingerprint when a field is omitted than when it is null", () => {
    // The fingerprint is what makes two calls with the same operationId either a
    // replay of the same intent or a CONFLICT between different intents. Collapsing
    // omission into null makes a partial update replay the result of a clear.
    for (const field of NULLABLE_FIELDS) {
      const omitted = canonicalMutationFingerprint("ega_update_task", {
        taskId: TASK_ID,
        title: "Same title",
      });
      const explicitNull = canonicalMutationFingerprint("ega_update_task", {
        taskId: TASK_ID,
        title: "Same title",
        [field]: null,
      });

      expect(omitted, `${field}: omission must not hash as an explicit null`).not.toBe(
        explicitNull,
      );
    }
  });

  it("does not treat an explicitly undefined value as an explicit null", () => {
    // `canonicalizeFingerprintValue` drops undefined OBJECT ENTRIES, so a field the
    // transport left as undefined hashes as absent. This is the property that makes
    // pass-through correct; assert it directly so a future canonicalizer change that
    // coerces undefined to null would break here first.
    const withUndefined = canonicalMutationFingerprint("ega_update_task", {
      taskId: TASK_ID,
      title: "Same title",
      description: undefined,
    });
    const withNull = canonicalMutationFingerprint("ega_update_task", {
      taskId: TASK_ID,
      title: "Same title",
      description: null,
    });
    const omitted = canonicalMutationFingerprint("ega_update_task", {
      taskId: TASK_ID,
      title: "Same title",
    });

    expect(withUndefined).toBe(omitted);
    expect(withUndefined).not.toBe(withNull);
  });

  it("hands the claim RPC a different args_hash for omitted vs explicit null", async () => {
    // End-to-end through the handler, so this fails if the SEMANTIC object ever
    // collapses the two again - not merely if the canonicalizer would.
    const omitted = await harness(freshTask());
    await omitted.handlers.updateTask(AUTH_INFO, {
      taskId: TASK_ID,
      title: "Same title",
      operationId: OP,
    });

    const cleared = await harness(freshTask());
    await cleared.handlers.updateTask(AUTH_INFO, {
      taskId: TASK_ID,
      title: "Same title",
      description: null,
      operationId: OP,
    });

    expect(omitted.claims).toHaveLength(1);
    expect(cleared.claims).toHaveLength(1);
    expect(omitted.claims[0].argsHash).not.toBe(cleared.claims[0].argsHash);
  });

  it("still produces a stable fingerprint for two identical calls", async () => {
    const first = await harness(freshTask());
    await first.handlers.updateTask(AUTH_INFO, {
      taskId: TASK_ID,
      title: "Same title",
      description: null,
      operationId: OP,
    });
    const second = await harness(freshTask());
    await second.handlers.updateTask(AUTH_INFO, {
      taskId: TASK_ID,
      title: "Same title",
      description: null,
      operationId: OP,
    });

    expect(first.claims[0].argsHash).toBe(second.claims[0].argsHash);
  });
});