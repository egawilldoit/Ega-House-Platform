#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { readFile, readdir, stat } from "node:fs/promises";
import process from "node:process";
import { REQUIRED_EGA_SKILLS, parseSkillFrontmatter } from "./validate-agent-context.mjs";

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function findSkillDocuments(root) {
  if (!(await isDirectory(root))) return [];
  const output = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolute = join(root, entry.name);
    if (entry.isDirectory()) output.push(...(await findSkillDocuments(absolute)));
    else if (entry.name === "SKILL.md") output.push(absolute);
  }
  return output;
}

function command(command, args) {
  return spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function resolveRepoRoot() {
  const result = command("git", ["rev-parse", "--show-toplevel"]);
  return result.status === 0 && result.stdout.trim() ? resolve(result.stdout.trim()) : process.cwd();
}

async function localShadowedSkills() {
  const localRoot = join(homedir(), ".hermes", "skills");
  const names = new Map();
  for (const file of await findSkillDocuments(localRoot)) {
    try {
      const parsed = parseSkillFrontmatter(await readFile(file, "utf8"), file).fields;
      const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
      if (name) names.set(name, file);
    } catch {
      // Hermes owns this directory; malformed unrelated local skills are reported by Hermes itself.
    }
  }
  return REQUIRED_EGA_SKILLS.filter((name) => names.has(name)).map((name) => ({ name, file: names.get(name) }));
}

async function main() {
  const repoRoot = resolveRepoRoot();
  const externalSkills = join(repoRoot, ".agents", "skills");

  if (!(await isDirectory(externalSkills))) {
    console.error(`DISCOVERY NOT VERIFIED repository skill directory missing: ${externalSkills}`);
    return 1;
  }

  const version = command("hermes", ["--version"]);
  if (version.error?.code === "ENOENT" || version.status === 127) {
    console.error("DISCOVERY NOT VERIFIED Hermes CLI is not installed on PATH.");
    console.error("Required follow-up: run this command under the actual Runner service user after installing Hermes.");
    return 2;
  }
  if (version.status !== 0) {
    console.error(`DISCOVERY NOT VERIFIED 'hermes --version' exited ${version.status}: ${version.stderr.trim()}`);
    return 2;
  }
  console.log(`Hermes version: ${(version.stdout || version.stderr).trim()}`);

  const shadows = await localShadowedSkills();
  if (shadows.length > 0) {
    for (const shadow of shadows) console.error(`DISCOVERY NOT VERIFIED local Hermes skill shadows repository '${shadow.name}': ${shadow.file}`);
    return 1;
  }

  const list = command("hermes", ["skills", "list"]);
  if (list.status !== 0) {
    console.error(`DISCOVERY NOT VERIFIED 'hermes skills list' exited ${list.status}: ${list.stderr.trim()}`);
    return 2;
  }

  const listing = `${list.stdout}\n${list.stderr}`;
  const missing = REQUIRED_EGA_SKILLS.filter((name) => !new RegExp(`(^|[^A-Za-z0-9_-])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9_-]|$)`, "m").test(listing));
  if (missing.length > 0) {
    console.error(`DISCOVERY NOT VERIFIED missing Hermes skills: ${missing.join(", ")}`);
    console.error("Configure ~/.hermes/config.yaml without exposing secrets:");
    console.error("skills:\n  external_dirs:\n    - " + externalSkills);
    return 1;
  }

  for (const name of REQUIRED_EGA_SKILLS) console.log(`DISCOVERY VERIFIED Hermes skill visible: ${name}`);
  console.log(`External repository skill directory: ${externalSkills}`);
  console.log("RUNTIME NOT VERIFIED this preflight does not prove semantic skill selection or Runner delivery behavior.");
  return 0;
}

process.exitCode = await main();
