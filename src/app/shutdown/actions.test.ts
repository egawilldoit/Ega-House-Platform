import assert from "node:assert/strict";
import test from "node:test";

import { getShutdownReturnPath } from "./actions";

test("shutdown actions keep return paths scoped to /shutdown", async () => {
  assert.equal(await getShutdownReturnPath("/shutdown"), "/shutdown");
  assert.equal(await getShutdownReturnPath("/shutdown?tab=carry"), "/shutdown?tab=carry");
  assert.equal(await getShutdownReturnPath("/today"), "/shutdown");
  assert.equal(await getShutdownReturnPath("https://example.com"), "/shutdown");
});
