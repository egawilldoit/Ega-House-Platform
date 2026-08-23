import type { SupabaseClient } from "@supabase/supabase-js";

import { createApp } from "../src/index";
import {
  PARITY_TODAY,
  parityGoalRows,
  parityProjectRows,
  parityRecurrenceRows,
  parityReminderRows,
  paritySessionRows,
  parityTaskRows,
} from "./fixtures.task-parity";

/**
 * Shared fake-Supabase harness for the canonical Tasks/Today parity suites.
 * Mirrors the queue-per-table builder used by the existing server tests so
 * query sequences stay observable per request.
 */

export type QueryResult = {
  data: unknown;
  error: { code?: string; message?: string } | null;
  count?: number | null;
};
export type Step = { method: string; args: unknown[] };

export class FakeSupabase {
  private readonly queues = new Map<string, QueryResult[]>();
  calls: Array<{ table: string; steps: Step[] }> = [];

  from(table: string) {
    return new FakeBuilder(table, this);
  }

  push(table: string, result: QueryResult) {
    const queue = this.queues.get(table) ?? [];
    queue.push(result);
    this.queues.set(table, queue);
  }

  pop(table: string): QueryResult {
    return this.queues.get(table)?.shift() ?? { data: null, error: null };
  }
}

class FakeBuilder {
  private readonly steps: Step[] = [];
  constructor(
    private readonly table: string,
    private readonly fake: FakeSupabase,
  ) {}

  select(...args: unknown[]) { this.steps.push({ method: "select", args }); return this; }
  eq(...args: unknown[]) { this.steps.push({ method: "eq", args }); return this; }
  is(...args: unknown[]) { this.steps.push({ method: "is", args }); return this; }
  in(...args: unknown[]) { this.steps.push({ method: "in", args }); return this; }
  neq(...args: unknown[]) { this.steps.push({ method: "neq", args }); return this; }
  not(...args: unknown[]) { this.steps.push({ method: "not", args }); return this; }
  or(...args: unknown[]) { this.steps.push({ method: "or", args }); return this; }
  order(...args: unknown[]) { this.steps.push({ method: "order", args }); return this; }
  limit(...args: unknown[]) { this.steps.push({ method: "limit", args }); return this; }
  insert(...args: unknown[]) { this.steps.push({ method: "insert", args }); return this; }
  update(...args: unknown[]) { this.steps.push({ method: "update", args }); return this; }
  upsert(...args: unknown[]) { this.steps.push({ method: "upsert", args }); return this; }
  delete(...args: unknown[]) { this.steps.push({ method: "delete", args }); return this; }
  maybeSingle(...args: unknown[]) { this.steps.push({ method: "maybeSingle", args }); return this; }
  single(...args: unknown[]) { this.steps.push({ method: "single", args }); return this; }

  then<TResult1, TResult2>(
    fulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    rejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    this.fake.calls.push({ table: this.table, steps: this.steps });
    return Promise.resolve(this.fake.pop(this.table)).then(fulfilled, rejected);
  }
}

export const AUTH = { authorization: "Bearer parity-token" };
export const JSON_HEADERS = { ...AUTH, "content-type": "application/json" };

export function makeApp(fake: FakeSupabase) {
  return createApp({
    verifyToken: async (token) => (token === "parity-token" ? "user-123" : null),
    createRequestClient: () => fake as unknown as SupabaseClient,
    now: () => new Date(`${PARITY_TODAY}T12:00:00.000Z`),
  });
}

/** Queues option lists plus a fully hydrated five-task list response. */
export function queueFullList(fake: FakeSupabase) {
  fake.push("projects", { data: parityProjectRows(), error: null });
  fake.push("goals", { data: parityGoalRows(), error: null });
  fake.push("tasks", { data: parityTaskRows(), error: null });
  fake.push("task_reminders", { data: parityReminderRows(), error: null });
  fake.push("task_recurrences", { data: parityRecurrenceRows(), error: null });
  fake.push("task_sessions", { data: paritySessionRows(), error: null });
}
