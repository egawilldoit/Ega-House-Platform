import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DEFAULT_PROJECT_DOC_MAX_BYTES,
  discoverCodexInstructionChain,
  findExecutablePgmqPopCalls,
  parseSkillFrontmatter,
  resolveMarkdownTarget,
  validateSkillDocuments,
} from "./validate-agent-context.mjs";

function skill(content) {
  return `---\n${content}\n---\n# Body\n`;
}

test("frontmatter: one-line description", () => {
  const result = parseSkillFrontmatter(skill("name: one\ndescription: A meaningful one-line description for testing."));
  assert.equal(result.fields.name, "one");
  assert.equal(result.fields.description, "A meaningful one-line description for testing.");
});

test("frontmatter: quoted description containing colon", () => {
  const result = parseSkillFrontmatter(skill('name: quoted\ndescription: "Use when: a colon appears in the trigger description."'));
  assert.equal(result.fields.description, "Use when: a colon appears in the trigger description.");
});

test("frontmatter: folded block scalar", () => {
  const result = parseSkillFrontmatter(skill("name: folded\ndescription: >\n  First folded line.\n  Second folded line."));
  assert.equal(result.fields.description, "First folded line. Second folded line.");
});

test("frontmatter: literal block scalar", () => {
  const result = parseSkillFrontmatter(skill("name: literal\ndescription: |\n  First literal line.\n  Second literal line."));
  assert.equal(result.fields.description, "First literal line.\nSecond literal line.");
});

test("frontmatter: CRLF", () => {
  const content = skill("name: crlf\ndescription: A meaningful CRLF description for testing.").replaceAll("\n", "\r\n");
  assert.equal(parseSkillFrontmatter(content).fields.name, "crlf");
});

test("frontmatter: missing name", () => {
  const errors = validateSkillDocuments([{ file: "missing-name/SKILL.md", content: skill("description: A meaningful description without a name.") }]);
  assert.match(errors.join("\n"), /name.*non-empty/);
});

test("frontmatter: missing description", () => {
  const errors = validateSkillDocuments([{ file: "missing-description/SKILL.md", content: skill("name: missing-description") }]);
  assert.match(errors.join("\n"), /description.*meaningful/);
});

test("frontmatter: malformed closing delimiter", () => {
  assert.throws(() => parseSkillFrontmatter("---\nname: broken\ndescription: broken"), /missing closing/);
});

test("frontmatter: duplicate names", () => {
  const errors = validateSkillDocuments([
    { file: "a/SKILL.md", content: skill("name: duplicate\ndescription: First meaningful duplicate description.") },
    { file: "b/SKILL.md", content: skill("name: duplicate\ndescription: Second meaningful duplicate description.") },
  ]);
  assert.match(errors.join("\n"), /duplicate skill name/);
});

for (const [name, source, expected] of [
  ["real call", "pgmq.pop();", 1],
  ["spaced call", "pgmq . pop ( );", 1],
  ["comment", "// Never use pgmq.pop()\npgmq.read();", 0],
  ["block comment", "/* pgmq.pop() */\npgmq.read();", 0],
  ["string", "const value = 'pgmq.pop()';", 0],
  ["template", "const value = `pgmq.pop()`;", 0],
  ["valid read", "pgmq.read();", 0],
  ["similar identifier", "not_pgmq_pop();", 0],
]) {
  test(`queue source: ${name}`, () => {
    assert.equal(findExecutablePgmqPopCalls(source, "fixture.ts").length, expected);
  });
}

async function withTempRepo(run) {
  const root = await mkdtemp(join(tmpdir(), "agent-context-test-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("markdown links: relative file, anchor, external, missing, and root-relative behavior", async () => {
  await withTempRepo(async (root) => {
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(join(root, "README.md"), "# Root\n");
    await writeFile(join(root, "docs", "target.md"), "# Target\n");
    assert.equal(resolveMarkdownTarget(root, "docs/source.md", "target.md"), join(root, "docs", "target.md"));
    assert.equal(resolveMarkdownTarget(root, "docs/source.md", "target.md#section"), join(root, "docs", "target.md"));
    assert.equal(resolveMarkdownTarget(root, "docs/source.md", "https://example.com/x"), null);
    assert.equal(resolveMarkdownTarget(root, "docs/source.md", "/README.md"), join(root, "README.md"));
    assert.equal(resolveMarkdownTarget(root, "docs/source.md", "missing.md"), join(root, "docs", "missing.md"));
  });
});

test("Codex discovery: root and nested AGENTS files are selected root-to-leaf", async () => {
  await withTempRepo(async (root) => {
    await mkdir(join(root, "apps", "mobile"), { recursive: true });
    await writeFile(join(root, "AGENTS.md"), "root");
    await writeFile(join(root, "apps", "AGENTS.md"), "apps");
    await writeFile(join(root, "apps", "mobile", "AGENTS.md"), "mobile");
    const result = await discoverCodexInstructionChain({ repoRoot: root, workingDirectory: join(root, "apps", "mobile") });
    assert.deepEqual(result.selectedFiles.map((entry) => entry.path), [join(root, "AGENTS.md"), join(root, "apps", "AGENTS.md"), join(root, "apps", "mobile", "AGENTS.md")]);
  });
});

test("Codex discovery: AGENTS.override.md wins over AGENTS.md in the same directory", async () => {
  await withTempRepo(async (root) => {
    await mkdir(join(root, "nested"), { recursive: true });
    await writeFile(join(root, "AGENTS.md"), "root");
    await writeFile(join(root, "nested", "AGENTS.md"), "normal");
    await writeFile(join(root, "nested", "AGENTS.override.md"), "override");
    const result = await discoverCodexInstructionChain({ repoRoot: root, workingDirectory: join(root, "nested") });
    assert.deepEqual(result.selectedFiles.map((entry) => entry.path), [join(root, "AGENTS.md"), join(root, "nested", "AGENTS.override.md")]);
  });
});

test("Codex discovery: unrelated sibling instructions are excluded", async () => {
  await withTempRepo(async (root) => {
    await mkdir(join(root, "a"), { recursive: true });
    await mkdir(join(root, "b"), { recursive: true });
    await writeFile(join(root, "AGENTS.md"), "root");
    await writeFile(join(root, "a", "AGENTS.md"), "a");
    await writeFile(join(root, "b", "AGENTS.md"), "b");
    const result = await discoverCodexInstructionChain({ repoRoot: root, workingDirectory: join(root, "a") });
    assert.deepEqual(result.selectedFiles.map((entry) => entry.path), [join(root, "AGENTS.md"), join(root, "a", "AGENTS.md")]);
  });
});

test("Codex discovery: configured fallback filename is used after standard names", async () => {
  await withTempRepo(async (root) => {
    await mkdir(join(root, "nested"), { recursive: true });
    await writeFile(join(root, "FALLBACK.md"), "fallback");
    const result = await discoverCodexInstructionChain({ repoRoot: root, workingDirectory: join(root, "nested"), fallbackFilenames: ["FALLBACK.md"] });
    assert.deepEqual(result.selectedFiles.map((entry) => entry.path), [join(root, "FALLBACK.md")]);
  });
});

test("Codex discovery: byte-budget overflow uses UTF-8 bytes", async () => {
  await withTempRepo(async (root) => {
    await writeFile(join(root, "AGENTS.md"), "é".repeat(20));
    const result = await discoverCodexInstructionChain({ repoRoot: root, workingDirectory: root, projectDocMaxBytes: 30 });
    assert.equal(result.combinedBytes, 40);
    assert.equal(result.withinBudget, false);
    assert.equal(DEFAULT_PROJECT_DOC_MAX_BYTES, 32768);
  });
});
