import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function read(...segments: string[]) {
  return readFileSync(path.join(process.cwd(), "src", ...segments), "utf8");
}

test("PR-01: retiring the legacy agent API also retires credential issuance", () => {
  assert.equal(existsSync(path.join(process.cwd(), "src", "app", "api", "agent")), false);

  const actions = read("app", "(workspace)", "agents", "actions.ts");
  assert.doesNotMatch(actions, /issueCredentialAction/);
  assert.doesNotMatch(actions, /issueAgentCredential/);

  const detail = read("app", "(workspace)", "agents", "[id]", "page.tsx");
  assert.doesNotMatch(detail, /IssueCredentialForm/);
  assert.doesNotMatch(detail, /Issue a credential/);
  assert.equal(
    existsSync(
      path.join(process.cwd(), "src", "app", "(workspace)", "agents", "[id]", "issue-credential-form.tsx"),
    ),
    false,
  );
});
