import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(
  new URL("../../app/api/oauth/decision/route.ts", import.meta.url),
  "utf8",
);

test("OAuth consent route consumes the shared verified identity boundary", () => {
  assert.match(routeSource, /getCurrentIdentity/);
  assert.match(routeSource, /ownerUserId:\s*identity\.id/);
  assert.doesNotMatch(routeSource, /auth\.getUser\(/);
});

test("OAuth consent route preserves protocol protections and decision service", () => {
  assert.match(routeSource, /requireSameOrigin\(request\)/);
  assert.match(routeSource, /parseAuthorizationId/);
  assert.match(routeSource, /parseConsentDecision/);
  assert.match(routeSource, /processOAuthConsentDecision/);
  assert.match(routeSource, /NextResponse\.redirect/);
});
