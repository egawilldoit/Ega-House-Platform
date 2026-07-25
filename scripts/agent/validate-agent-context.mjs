#!/usr/bin/env node

import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, readdir, stat } from "node:fs/promises";
import process from "node:process";
import {
  DEFAULT_PROJECT_DOC_MAX_BYTES,
  REQUIRED_EGA_SKILLS,
  discoverCodexInstructionChain,
  findExecutablePgmqPopCalls,
  loadCodexDiscoveryConfig,
  parseCodexConfig,
  parseSkillFrontmatter,
  resolveMarkdownTarget,
  validateSkillDocuments,
} from "./agent-context-core.mjs";

export {
  DEFAULT_PROJECT_DOC_MAX_BYTES,
  REQUIRED_EGA_SKILLS,
  discoverCodexInstructionChain,
  findExecutablePgmqPopCalls,
  loadCodexDiscoveryConfig,
  parseCodexConfig,
  parseSkillFrontmatter,
  resolveMarkdownTarget,
  validateSkillDocuments,
};

const ignored = new Set([".git", ".next", ".expo", "node_modules", "coverage", "dist", "build"]);
const required = [
  "AGENTS.md", "ARCHITECTURE.md", "HERMES_MASTER_PROMPT.md",
  "docs/agent-context/index.md", "docs/agent-context/product-authority.md",
  "docs/agent-context/testing-and-validation.md", "docs/agent-context/skill-routing-evaluation.md",
  "docs/architecture/delivery-lifecycle.md", "docs/architecture/queue-and-leases.md",
  "docs/architecture/runner-and-worktrees.md", "docs/architecture/hermes-execution.md",
];
const conflicts = [
  [/(?:work|implement|commit)\s+(?:directly\s+)?on\s+main/i, "direct main-branch implementation"],
  [/auto[- ]merge\s+(?:all|every|without\s+(?:review|approval)|by\s+default)/i, "broad automatic merge"],
  [/(?:Hermes|agent).{0,40}(?:output|exit code|result JSON).{0,30}(?:is|as)\s+(?:proof|success)/i, "agent self-certification"],
  [/pgmq\s*\.\s*pop\s*\([^)]*\).{0,40}(?:canonical|recommended|required)/i, "unsafe queue consumption"],
];

const exists = async (file, type = "file") => {
  try { const value = await stat(file); return type === "directory" ? value.isDirectory() : value.isFile(); }
  catch { return false; }
};

async function walk(root, predicate = () => true) {
  if (!(await exists(root, "directory"))) return [];
  const output = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory() && ignored.has(entry.name)) continue;
    const file = join(root, entry.name);
    if (entry.isDirectory()) output.push(...await walk(file, predicate));
    else if (predicate(file)) output.push(file);
  }
  return output;
}

async function validateFiles(root, errors, output) {
  for (const file of required) {
    if (!(await exists(join(root, file)))) errors.push(`missing required agent-context file: ${file}`);
    else output.push(`FILE EXISTS ${file}`);
  }
}

async function validateSkills(root, errors, output) {
  const files = await walk(join(root, ".agents"), (file) => file.endsWith("SKILL.md"));
  const docs = await Promise.all(files.map(async (file) => ({ file: relative(root, file), content: await readFile(file, "utf8") })));
  errors.push(...validateSkillDocuments(docs));
  if (!files.length) errors.push("no .agents SKILL.md files found");
  else output.push(`STRUCTURAL PASS skill metadata parsed for ${files.length} file(s)`);
}

async function validateLinks(root, errors, output) {
  const docs = [
    "AGENTS.md", "ARCHITECTURE.md", "HERMES_MASTER_PROMPT.md", "scripts/ega-runner/README.md",
    ...(await walk(join(root, "docs", "agent-context"), (file) => file.endsWith(".md"))).map((file) => relative(root, file)),
    ...(await walk(join(root, "docs", "architecture"), (file) => file.endsWith(".md"))).map((file) => relative(root, file)),
  ];
  let checked = 0;
  for (const file of docs) {
    if (!(await exists(join(root, file)))) continue;
    const text = await readFile(join(root, file), "utf8");
    for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const target = resolveMarkdownTarget(root, file, match[1]);
      if (!target) continue;
      checked += 1;
      if (!(await exists(target)) && !(await exists(target, "directory"))) errors.push(`${file}: broken local link '${match[1]}'`);
    }
  }
  output.push(`STRUCTURAL PASS checked ${checked} local Markdown link(s); /path resolves from repository root`);
}

async function validateCommands(root, errors, output) {
  for (const [file, commands] of [
    ["package.json", ["build", "lint", "test", "typecheck", "test:agent-context", "validate:agent-context"]],
    ["apps/mobile/package.json", ["typecheck", "test", "doctor", "validate:bundle"]],
    ["scripts/ega-runner/package.json", ["start", "typecheck", "smoke"]],
  ]) {
    try {
      const manifest = JSON.parse(await readFile(join(root, file), "utf8"));
      for (const command of commands) manifest.scripts?.[command]
        ? output.push(`COMMAND DECLARED ${file}#${command}`)
        : errors.push(`${file}: missing documented npm script '${command}'`);
    } catch (error) { errors.push(`${file}: invalid or unreadable JSON (${error.message})`); }
  }
  for (const file of ["execution-contract.test.mjs", "hermes-executor.test.mjs", "schema-preflight.test.mjs", "worktree-cleanup.test.mjs"].map((file) => `scripts/ega-runner/test/${file}`)) {
    if (await exists(join(root, file))) output.push(`FILE EXISTS ${file}`);
    else errors.push(`documented Runner validation file does not exist: ${file}`);
  }
}

async function validateQueue(root, errors, output) {
  const files = await walk(join(root, "scripts", "ega-runner", "src"), (file) => /\.(ts|tsx|js|mjs)$/.test(file));
  let total = 0;
  for (const file of files) {
    const findings = findExecutablePgmqPopCalls(await readFile(file, "utf8"), relative(root, file));
    total += findings.length;
    for (const finding of findings) errors.push(`${finding.file}:${finding.line}:${finding.column}: executable pgmq.pop() call is forbidden`);
  }
  if (!total) output.push(`STRUCTURAL PASS no executable pgmq.pop() calls in ${files.length} Runner source file(s)`);
}

async function validateInstructions(root, errors, warnings, output, options) {
  const config = await loadCodexDiscoveryConfig({ repoRoot: root, env: options.env ?? process.env, userHome: options.userHome ?? homedir() });
  for (const cwd of [".", "apps/mobile", "scripts/ega-runner", "src"]) {
    const absolute = resolve(root, cwd);
    if (!(await exists(absolute, "directory"))) { output.push(`RUNTIME NOT VERIFIED instruction directory missing: ${cwd}`); continue; }
    const chain = await discoverCodexInstructionChain({ repoRoot: root, workingDirectory: absolute, ...config });
    output.push(`Working directory: ${cwd}`);
    output.push(`Selected instruction files: ${chain.selectedFiles.length ? chain.selectedFiles.map((file) => relative(root, file.path)).join(", ") : "none"}`);
    output.push(`Combined bytes: ${chain.combinedBytes}`);
    output.push(`Configured/default maximum: ${chain.projectDocMaxBytes}`);
    output.push(`Result: ${chain.withinBudget ? "STRUCTURAL PASS" : "STRUCTURAL FAIL"}`);
    if (!chain.withinBudget) errors.push(`${cwd}: Codex instruction chain is ${chain.combinedBytes} bytes, above ${chain.projectDocMaxBytes}`);
  }

  const instructionFiles = await walk(root, (file) => ["AGENTS.md", "AGENTS.override.md"].includes(file.split(sep).at(-1)));
  const checked = new Set();
  for (const instruction of instructionFiles) {
    const chain = await discoverCodexInstructionChain({ repoRoot: root, workingDirectory: dirname(instruction), ...config });
    for (const selected of chain.selectedFiles) {
      const file = relative(root, selected.path);
      if (file === "AGENTS.md" || checked.has(selected.path)) continue;
      checked.add(selected.path);
      const text = await readFile(selected.path, "utf8");
      for (const [pattern, label] of conflicts) if (pattern.test(text)) errors.push(`${file}: conflicts with root authority (${label})`);
    }
  }

  const rootBytes = Buffer.byteLength(await readFile(join(root, "AGENTS.md"), "utf8"), "utf8");
  if (rootBytes > config.projectDocMaxBytes / 2) warnings.push(`MAINTAINABILITY WARNING AGENTS.md uses ${rootBytes}/${config.projectDocMaxBytes} instruction bytes`);
  output.push(`Config inspected: ${config.inspectedConfigFiles.length ? config.inspectedConfigFiles.join(", ") : "none; using 32768-byte default"}`);
}

export async function validateRepository(repoRoot, options = {}) {
  const root = resolve(repoRoot);
  const result = { errors: [], warnings: [], output: [] };
  await validateFiles(root, result.errors, result.output);
  await validateSkills(root, result.errors, result.output);
  await validateLinks(root, result.errors, result.output);
  await validateCommands(root, result.errors, result.output);
  await validateQueue(root, result.errors, result.output);
  await validateInstructions(root, result.errors, result.warnings, result.output, options);
  result.output.push("RUNTIME NOT VERIFIED this command does not prove semantic documentation accuracy, command success, Codex skill selection, Hermes discovery, or external systems");
  return result;
}

async function main() {
  const result = await validateRepository(process.cwd());
  result.output.forEach((line) => console.log(line));
  result.warnings.forEach((line) => console.warn(line));
  result.errors.forEach((line) => console.error(`ERROR: ${line}`));
  if (result.errors.length) console.error(`Agent-context structural validation failed with ${result.errors.length} error(s).`);
  else console.log("STRUCTURAL PASS agent-context validation completed.");
  return result.errors.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
