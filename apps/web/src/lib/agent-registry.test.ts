import assert from "node:assert/strict";
import test from "node:test";

import {
  agentInitials,
  describeAgentEvent,
  formatAgentCapabilities,
  mergeAgentCapabilities,
  validateAgentCredential,
  validateAgentIdentity,
} from "./agent-registry";

test("agent identity validation accepts only supported kinds and colours", () => {
  const valid = validateAgentIdentity({
    displayName: "  Codex ",
    kind: "codex",
    role: " Implementation ",
    avatarColor: "violet",
  });
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.value.displayName, "Codex");
    assert.equal(valid.value.role, "Implementation");
    assert.equal(valid.value.kind, "codex");
  }

  assert.equal(validateAgentIdentity({ displayName: "", kind: "codex" }).ok, false);
  assert.equal(validateAgentIdentity({ displayName: "x", kind: "unknown" }).ok, false);
  assert.equal(
    validateAgentIdentity({ displayName: "x", kind: "custom", avatarColor: "#ff0000" }).ok,
    false,
  );
  assert.equal(
    validateAgentIdentity({ displayName: "x\u0000y", kind: "custom" }).ok,
    false,
  );
});

test("credential validation rejects empty and unknown capabilities", () => {
  const valid = validateAgentCredential({
    name: "Local workspace",
    scopes: { tasks: { read: true, updateAny: true }, projects: { read: true } },
  });
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.value.scopes.tasks?.read, true);
    assert.equal(valid.value.scopes.tasks?.updateAny, true);
    assert.equal(valid.value.scopes.projects?.read, true);
    assert.equal(valid.value.scopes.goals, undefined);
  }

  assert.equal(validateAgentCredential({ name: "x", scopes: {} }).ok, false);
  assert.equal(
    validateAgentCredential({ name: "x", scopes: { tasks: { delete: true } } }).ok,
    false,
  );
  assert.equal(
    validateAgentCredential({ name: "x", scopes: { tasks: { bulkLimit: 51 } } }).ok,
    false,
  );
});

test("capabilities merge additively across active credentials", () => {
  const capabilities = mergeAgentCapabilities([
    { tasks: { read: true, bulk: true, bulkLimit: 5 } },
    { tasks: { create: true, bulkLimit: 20 }, goals: { read: true } },
    { projects: { read: true } },
  ]);

  assert.equal(capabilities.tasks.read, true);
  assert.equal(capabilities.tasks.create, true);
  assert.equal(capabilities.tasks.updateAny, false);
  assert.equal(capabilities.tasks.bulkLimit, 20);
  assert.equal(capabilities.goals.read, true);
  assert.equal(capabilities.projects.read, true);
  assert.deepEqual(formatAgentCapabilities(capabilities), [
    "Tasks: read, create, bulk (up to 20 per request)",
    "Projects: read",
    "Goals: read",
  ]);
});

test("agent event labels come from the durable action string", () => {
  assert.equal(describeAgentEvent("task.created", "success"), "Created a task");
  assert.equal(describeAgentEvent("task.updated", "failure"), "Updated a task — failed");
  assert.equal(describeAgentEvent("custom.action", "success"), "Custom action");
});

test("initials are bounded to two words and never blank", () => {
  assert.equal(agentInitials("OpenCode Worker"), "OW");
  assert.equal(agentInitials("codex"), "C");
  assert.equal(agentInitials("   "), "?");
});
