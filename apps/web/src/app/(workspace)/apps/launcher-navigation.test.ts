import assert from "node:assert/strict";
import test from "node:test";

import { getNextLauncherIndex, isLauncherActivationKey } from "./launcher-navigation";

test("moves focus horizontally between launcher items", () => {
  assert.equal(
    getNextLauncherIndex({ currentIndex: 0, key: "ArrowRight", totalItems: 5, columns: 2 }),
    1,
  );
  assert.equal(
    getNextLauncherIndex({ currentIndex: 0, key: "ArrowLeft", totalItems: 5, columns: 2 }),
    4,
  );
});

test("moves focus vertically and supports home/end keys", () => {
  assert.equal(
    getNextLauncherIndex({ currentIndex: 0, key: "ArrowDown", totalItems: 5, columns: 2 }),
    2,
  );
  assert.equal(
    getNextLauncherIndex({ currentIndex: 4, key: "ArrowUp", totalItems: 5, columns: 2 }),
    2,
  );
  assert.equal(
    getNextLauncherIndex({ currentIndex: 3, key: "Home", totalItems: 5, columns: 2 }),
    0,
  );
  assert.equal(
    getNextLauncherIndex({ currentIndex: 1, key: "End", totalItems: 5, columns: 2 }),
    4,
  );
});

test("returns null for unrelated key presses and handles activation keys", () => {
  assert.equal(
    getNextLauncherIndex({ currentIndex: 1, key: "x", totalItems: 5, columns: 2 }),
    null,
  );
  assert.equal(isLauncherActivationKey("Enter"), true);
  assert.equal(isLauncherActivationKey(" "), true);
  assert.equal(isLauncherActivationKey("Tab"), false);
});
