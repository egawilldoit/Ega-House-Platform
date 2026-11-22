import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function read(...segments: string[]) {
  return readFileSync(path.join(process.cwd(), "src", ...segments), "utf8");
}

test("PR-01: retiring the legacy agent API also retires credential issuance", () => {
  assert.equal(existsSync(path.join(process.cwd(), "src", "app", "api", "agent")), false);

  const actions = read("app", "(workspace)", "settings", "_actions", "agent-actions.ts");
  assert.doesNotMatch(actions, /issueCredentialAction/);
  assert.doesNotMatch(actions, /issueAgentCredential/);

  const integrations = read(
    "app",
    "(workspace)",
    "settings",
    "_components",
    "agent-settings.tsx",
  );
  assert.doesNotMatch(integrations, /IssueCredentialForm/);
  assert.doesNotMatch(integrations, /Issue a credential/);

  assert.equal(
    existsSync(path.join(process.cwd(), "src", "app", "(workspace)", "agents")),
    false,
  );
});
