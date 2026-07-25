#!/usr/bin/env node

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const errors = [];
const warnings = [];

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
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) output.push(...(await walk(relative, predicate)));
    else if (predicate(relative)) output.push(relative);
  }
  return output;
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
await validateQueueSafety();

for (const warning of warnings) console.warn(`WARN: ${warning}`);
if (errors.length > 0) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  console.error(`Agent-context validation failed with ${errors.length} error(s).`);
  process.exit(1);
}

console.log("Agent-context validation passed.");
