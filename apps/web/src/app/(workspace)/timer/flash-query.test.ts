import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTimerRedirectHref,
  clearTimerFlashParamsFromHref,
} from "./flash-query";

test("buildTimerRedirectHref adds actionSuccess for correction flow", () => {
  const href = buildTimerRedirectHref("/timer", {
    successMessage: "Session timing updated.",
    anchor: "#session-123",
  });

  assert.equal(
    href,
    "/timer?actionSuccess=Session+timing+updated.#session-123",
  );
});

test("clearTimerFlashParamsFromHref removes action flash params and keeps anchor", () => {
  const href = clearTimerFlashParamsFromHref(
    "/timer?filter=today&actionSuccess=Session+timing+updated.&actionError=bad#session-123",
  );

  assert.equal(href, "/timer?filter=today#session-123");
});

test("clearTimerFlashParamsFromHref is a no-op when no flash params exist", () => {
  const href = clearTimerFlashParamsFromHref("/timer?filter=today#session-123");
  assert.equal(href, "/timer?filter=today#session-123");
});
