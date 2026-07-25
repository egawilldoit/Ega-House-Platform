#!/usr/bin/env node

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const errors = [];
const warnings = [];
const ignoredDirectories = new Set([
  ".git",
  ".next",
  ".expo",
  "node_modules",
  "coverage",
  "dist",
  "build",
]);

const required = [
  "AGENTS.md",
  "ARCHITECTURE.md",
  "HERMES_MASTER_PROMPT.md",
  "docs/agent-context/index.md",
  "docs/agent-context/product-authority.md",
  "docs/agent-context/testing-and-validation.md",
  "docs/architecture/delivery-lifecycle.md",
  "docs/architecture/queue-and-leases.md",
  "docs/architecture/runner-and-worktrees.md",
  "docs/architecture/hermes-execution.md",
];

async function exists(relativePath) {
  try {
    await stat(path.join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function walk(dir, predicate = () => true) {
  const absolute = path.join(root, dir);
  if (!(await exists(dir))) return [];
  const output = [];
  for (const entry of await readdir(absolute, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) output.push(...(await walk(relative, predicate)));
    else if (predicate(relative)) output.push(relative);
  }
  return output;
}

async function readJson(relativePath) {
  try {
    return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
  } catch (error) {
    errors.push(`${relativePath}: invalid or unreadable JSON (${error instanceof Error ? error.message : String(error)})`);
    return null;
  }
}

function parseFrontmatter(content, file) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) {
    errors.push(`${file}: missing YAML frontmatter`);
    return null;
  }
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return fields;
}

async function validateRequiredFiles() {
  for (const file of required) {
    if (!(await exists(file))) errors.push(`missing required agent-context file: ${file}`);
  }
}

async function validateSkills() {
  const skillFiles = await walk(".agents", (file) => file.endsWith("SKILL.md"));
  const names = new Map();
  for (const file of skillFiles) {
    const content = await readFile(path.join(root, file), "utf8");
    const fields = parseFrontmatter(content, file);
    if (!fields) continue;
    const name = fields.name?.replace(/^['"]|['"]$/g, "");
    const description = fields.description?.replace(/^['"]|['"]$/g, "");
    if (!name) errors.push(`${file}: frontmatter name is empty`);
    if (!description || description.length < 20) errors.push(`${file}: description must explain trigger/scope`);
    if (name) {
      if (names.has(name)) errors.push(`duplicate skill name '${name}': ${names.get(name)} and ${file}`);
      else names.set(name, file);
    }
  }
  if (skillFiles.length === 0) errors.push("no .agents SKILL.md files found");
}

async function validateMarkdownLinks() {
  const files = [
    "AGENTS.md",
    "ARCHITECTURE.md",
    "HERMES_MASTER_PROMPT.md",
    "scripts/ega-runner/README.md",
    ...(await walk("docs/agent-context", (file) => file.endsWith(".md"))),
    ...(await walk("docs/architecture", (file) => file.endsWith(".md"))),
  ];
  const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
  for (const file of files) {
    if (!(await exists(file))) continue;
    const content = await readFile(path.join(root, file), "utf8");
    for (const match of content.matchAll(linkPattern)) {
      const target = match[1].trim();
      if (!target || target.startsWith("#") || /^(https?:|mailto:|tel:)/i.test(target)) continue;
      const withoutAnchor = target.split("#", 1)[0];
      const resolved = path.normalize(path.join(path.dirname(file), withoutAnchor));
      if (!(await exists(resolved))) errors.push(`${file}: broken local link '${target}'`);
    }
  }
}

async function validateRootInstructions() {
  const content = await readFile(path.join(root, "AGENTS.md"), "utf8");
  const lineCount = content.split(/\r?\n/).length;
  if (lineCount > 220) errors.push(`AGENTS.md is ${lineCount} lines; keep root instructions under 220 lines`);
  if (content.includes("ega-house-auto-pipeline")) errors.push("AGENTS.md references removed/nonexistent ega-house-auto-pipeline skill");
}

async function validateInstructionChain() {
  const instructionFiles = await walk(".", (file) => {
    const name = path.basename(file);
    return name === "AGENTS.md" || name === "AGENTS.override.md";
  });
  let totalLines = 0;
  const conflictPatterns = [
    { pattern: /(?:work|implement|commit)\s+(?:directly\s+)?on\s+main/i, label: "direct main-branch implementation" },
    { pattern: /auto[- ]merge\s+(?:all|every|without\s+(?:review|approval)|by\s+default)/i, label: "broad automatic merge" },
    { pattern: /(?:Hermes|agent).{0,40}(?:output|exit code|result JSON).{0,30}(?:is|as)\s+(?:proof|success)/i, label: "agent self-certification" },
    { pattern: /pgmq\s*\.\s*pop\s*\([^)]*\).{0,40}(?:canonical|recommended|required)/i, label: "unsafe queue consumption" },
  ];

  for (const file of instructionFiles) {
    const content = await readFile(path.join(root, file), "utf8");
    totalLines += content.split(/\r?\n/).length;
    if (path.normalize(file) === "AGENTS.md") continue;
    for (const { pattern, label } of conflictPatterns) {
      if (pattern.test(content)) errors.push(`${file}: conflicts with root authority (${label})`);
    }
  }

  if (totalLines > 400) {
    errors.push(`automatically loaded AGENTS instruction chain is ${totalLines} lines; keep total at or below 400`);
  }
}

async function validateCommands() {
  const rootPackage = await readJson("package.json");
  const mobilePackage = await readJson("apps/mobile/package.json");
  const runnerPackage = await readJson("scripts/ega-runner/package.json");

  const requiredScripts = [
    ["package.json", rootPackage, ["build", "lint", "test", "typecheck", "validate:agent-context"]],
    ["apps/mobile/package.json", mobilePackage, ["typecheck", "test", "doctor", "validate:bundle"]],
    ["scripts/ega-runner/package.json", runnerPackage, ["start", "typecheck", "smoke"]],
  ];

  for (const [file, manifest, scripts] of requiredScripts) {
    if (!manifest) continue;
    for (const script of scripts) {
      if (!manifest.scripts?.[script]) errors.push(`${file}: missing documented npm script '${script}'`);
    }
  }

  const documentedRunnerTests = [
    "scripts/ega-runner/test/execution-contract.test.mjs",
    "scripts/ega-runner/test/hermes-executor.test.mjs",
    "scripts/ega-runner/test/schema-preflight.test.mjs",
    "scripts/ega-runner/test/worktree-cleanup.test.mjs",
  ];
  for (const file of documentedRunnerTests) {
    if (!(await exists(file))) errors.push(`documented Runner validation file does not exist: ${file}`);
  }
}

async function validateQueueSafety() {
  const runnerFiles = await walk("scripts/ega-runner/src", (file) => /\.(ts|js|mjs)$/.test(file));
  for (const file of runnerFiles) {
    const content = await readFile(path.join(root, file), "utf8");
    if (/pgmq\s*\.\s*pop\s*\(/i.test(content)) errors.push(`${file}: direct pgmq.pop() is forbidden`);
  }
}

await validateRequiredFiles();
await validateSkills();
await validateMarkdownLinks();
await validateRootInstructions();
await validateInstructionChain();
await validateCommands();
await validateQueueSafety();

for (const warning of warnings) console.warn(`WARN: ${warning}`);
if (errors.length > 0) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  console.error(`Agent-context validation failed with ${errors.length} error(s).`);
  process.exit(1);
}

console.log("Agent-context validation passed.");
