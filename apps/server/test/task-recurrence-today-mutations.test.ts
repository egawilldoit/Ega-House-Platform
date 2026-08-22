import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createApp } from "../src/index";

type Result = { data: unknown; error: { code?: string; message?: string } | null; count?: number | null };
type Step = { method: string; args: unknown[] };
class FakeSupabase {
  queues = new Map<string, Result[]>(); calls: Array<{ table: string; steps: Step[] }> = [];
  from(table: string) { return new Builder(table, this); }
  push(table: string, result: Result) { const q = this.queues.get(table) ?? []; q.push(result); this.queues.set(table, q); }
  pop(table: string) { return this.queues.get(table)?.shift() ?? { data: null, error: null }; }
}
class Builder {
  steps: Step[] = [];
  constructor(private table: string, private fake: FakeSupabase) {}
  select(...args: unknown[]) { this.steps.push({method:"select",args}); return this; }
  eq(...args: unknown[]) { this.steps.push({method:"eq",args}); return this; }
  in(...args: unknown[]) { this.steps.push({method:"in",args}); return this; }
  is(...args: unknown[]) { this.steps.push({method:"is",args}); return this; }
  order(...args: unknown[]) { this.steps.push({method:"order",args}); return this; }
  upsert(...args: unknown[]) { this.steps.push({method:"upsert",args}); return this; }
  update(...args: unknown[]) { this.steps.push({method:"update",args}); return this; }
  delete(...args: unknown[]) { this.steps.push({method:"delete",args}); return this; }
  maybeSingle(...args: unknown[]) { this.steps.push({method:"maybeSingle",args}); return this; }
  single(...args: unknown[]) { this.steps.push({method:"single",args}); return this; }
  then<A,B>(ok?: ((v: Result)=>A|PromiseLike<A>)|null, fail?: ((r:unknown)=>B|PromiseLike<B>)|null): Promise<A|B> {
    this.fake.calls.push({table:this.table,steps:this.steps}); return Promise.resolve(this.fake.pop(this.table)).then(ok,fail);
  }
}
const AUTH = { authorization: "Bearer good" };
const JSON_HEADERS = { ...AUTH, "content-type": "application/json" };
function app(fake: FakeSupabase) { return createApp({ verifyToken: async t => t === "good" ? "user-123" : null, createRequestClient: () => fake as unknown as SupabaseClient, now: () => new Date("2026-08-10T12:00:00Z") }); }
function row() { return { id:"task-1",title:"Task",description:null,blocked_reason:null,status:"todo",priority:"medium",due_date:null,estimate_minutes:null,project_id:"project-1",goal_id:null,planned_for_date:null,focus_rank:null,scheduled_start_at:null,scheduled_end_at:null,calendar_sync_enabled:false,calendar_reminder_minutes:10,completed_at:null,archived_at:null,created_at:"2026-08-10T00:00:00Z",updated_at:"2026-08-10T00:00:00Z" }; }
function hydrate(fake: FakeSupabase) { fake.push("tasks",{data:row(),error:null}); fake.push("task_reminders",{data:[],error:null}); fake.push("task_recurrences",{data:[],error:null}); }

test("PUT /api/tasks/:id/recurrence sets canonical recurrence for verified actor", async () => {
  const fake = new FakeSupabase(); fake.push("task_recurrences",{data:null,error:null}); hydrate(fake);
  const response = await app(fake).request("/api/tasks/task-1/recurrence",{method:"PUT",headers:JSON_HEADERS,body:JSON.stringify({recurrenceRule:"daily",recurrenceAnchorDate:"2026-08-10",recurrenceTimezone:"UTC",fallbackAnchorDate:"2026-08-10"})});
  assert.equal(response.status,200);
  const call = fake.calls.find(c=>c.table==="task_recurrences");
  assert.ok(call?.steps.some(s=>s.method==="upsert" && (s.args[0] as Record<string,unknown>).owner_user_id === "user-123"));
});

test("DELETE /api/tasks/:id/recurrence clears recurrence with owner scope", async () => {
  const fake = new FakeSupabase(); fake.push("task_recurrences",{data:null,error:null}); hydrate(fake);
  const response = await app(fake).request("/api/tasks/task-1/recurrence",{method:"DELETE",headers:AUTH});
  assert.equal(response.status,200);
  assert.ok(fake.calls[0]?.steps.some(s=>s.method==="eq" && s.args[0]==="owner_user_id" && s.args[1]==="user-123"));
});

test("Today mutation endpoints plan, remove, update status, and clear completed", async () => {
  const fake = new FakeSupabase();
  hydrate(fake); hydrate(fake); hydrate(fake); fake.push("tasks",{data:null,error:null,count:2});
  const a = app(fake);
  const planned = await a.request("/api/today/tasks/task-1",{method:"POST",headers:JSON_HEADERS,body:JSON.stringify({date:"2026-08-10"})});
  assert.equal(planned.status,200);
  assert.deepEqual(await planned.json(),{ok:true,taskId:"task-1"});
  const removed = await a.request("/api/today/tasks/task-1",{method:"DELETE",headers:AUTH});
  assert.equal(removed.status,200);
  assert.deepEqual(await removed.json(),{ok:true,taskId:"task-1"});
  const status = await a.request("/api/today/tasks/task-1/status",{method:"PATCH",headers:JSON_HEADERS,body:JSON.stringify({status:"in_progress"})});
  assert.equal(status.status,200);
  const statusBody = await status.json();
  assert.equal(statusBody.ok,true);
  assert.equal(statusBody.taskId,"task-1");
  const updateSteps = fake.calls.filter(c=>c.table==="tasks").map(c=>c.steps.find(s=>s.method==="update")).filter(Boolean) as Array<{args:unknown[]}>;
  const lastUpdate = [...updateSteps].reverse()[0]?.args[0] as Record<string,unknown>;
  assert.equal(lastUpdate.status,"in_progress");
  const clear = await a.request("/api/today/clear-completed",{method:"POST",headers:JSON_HEADERS,body:JSON.stringify({date:"2026-08-10"})});
  assert.equal(clear.status,200);
  assert.deepEqual(await clear.json(),{ok:true});
});
