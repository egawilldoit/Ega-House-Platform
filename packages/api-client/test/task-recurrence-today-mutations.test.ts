import assert from "node:assert/strict";
import test from "node:test";
import { createEgaApiClient } from "../src/client";
import type { FetchLike } from "../src/http";

function harness() {
  const calls: Array<{ url:string; method:string; body:unknown }> = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({url,method:init.method,body:init.body ? JSON.parse(init.body) : undefined});
    return new Response(JSON.stringify({ok:true,task:{id:"task-1"},clearedCount:2}),{status:200,headers:{"content-type":"application/json"}});
  };
  return { calls, client:createEgaApiClient({baseUrl:"https://api.ega.example",getAccessToken:()=>"token",fetch:fetch as never}) };
}

test("task recurrence and Today mutations use the authenticated Hono contract", async () => {
  const {client,calls}=harness();
  await client.tasks.setRecurrence("task-1",{recurrenceRule:"daily",recurrenceAnchorDate:"2026-08-10",recurrenceTimezone:"UTC",fallbackAnchorDate:"2026-08-10"});
  await client.tasks.clearRecurrence("task-1");
  await client.today.plan("task-1","2026-08-10");
  await client.today.remove("task-1");
  await client.today.updateStatus("task-1","in_progress");
  await client.today.clearCompleted("2026-08-10");
  assert.deepEqual(calls.map(c=>[c.method,c.url]),[
    ["PUT","https://api.ega.example/api/tasks/task-1/recurrence"],
    ["DELETE","https://api.ega.example/api/tasks/task-1/recurrence"],
    ["POST","https://api.ega.example/api/today/tasks/task-1"],
    ["DELETE","https://api.ega.example/api/today/tasks/task-1"],
    ["PATCH","https://api.ega.example/api/today/tasks/task-1/status"],
    ["POST","https://api.ega.example/api/today/clear-completed"],
  ]);
  assert.deepEqual(calls[2].body,{date:"2026-08-10"});
  assert.deepEqual(calls[4].body,{status:"in_progress"});
  assert.deepEqual(calls[5].body,{date:"2026-08-10"});
});
