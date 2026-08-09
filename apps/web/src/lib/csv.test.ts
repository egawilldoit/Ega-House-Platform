import assert from "node:assert/strict";
import test from "node:test";

import { toCsvDocument, toCsvRow } from "./csv";

test("toCsvRow escapes commas, quotes, and newlines", () => {
  assert.equal(
    toCsvRow(["plain", "with,comma", 'say "hi"', "line 1\nline 2", null]),
    'plain,"with,comma","say ""hi""","line 1\nline 2",',
  );
});

test("toCsvDocument prepends headers and preserves row order", () => {
  assert.equal(
    toCsvDocument(["col_a", "col_b"], [["first", 1], ["second", 2]]),
    "col_a,col_b\nfirst,1\nsecond,2",
  );
});
