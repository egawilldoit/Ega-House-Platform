#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { readFile, readdir, stat } from "node:fs/promises";
import process from "node:process";
import { parseHermesExternalDirs, REQUIRED_EGA_SKILLS, parseSkillFrontmatter } from "./agent-context-core.mjs";

async function isFile(path) {
  try { return (await stat(path)).isFile(); }
  catch { return false; }
}

async function isDirectory(path) {
  try { return (await stat(path)).isDirectory(); }
  catch { return false; }
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

function command(commandName, args) {
  return spawnSync(commandName, args, {
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

function parseJsonResult(result) {
  if (result.status !== 0) return undefined;
  const text = (result.stdout || result.stderr || "").trim();
  if (!text) return undefined;
  try { return JSON.parse(text); }
  catch { return undefined; }
}

function findStringArray(value) {
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) return value;
  if (!value || typeof value !== "object") return [];
  for (const child of Object.values(value)) {
    const match = findStringArray(child);
    if (match.length) return match;
  }
  return [];
}

function findBoolean(value) {
  if (typeof value === "boolean") return value;
  if (!value || typeof value !== "object") return undefined;
  for (const child of Object.values(value)) {
    const match = findBoolean(child);
    if (match !== undefined) return match;
  }
  return undefined;
}

async function repositorySkillNames(root) {
  const names = new Map();
  for (const file of await findSkillDocuments(root)) {
    try {
      const parsed = parseSkillFrontmatter(await readFile(file, "utf8"), file).fields;
      const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
      if (name) names.set(name, file);
    } catch (error) {
      console.error(`DISCOVERY NOT VERIFIED invalid repository skill metadata: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
  return names;
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

async function configuredExternalFallback(externalSkills) {
  const configFile = join(homedir(), ".hermes", "config.yaml");
  if (!(await isFile(configFile))) return { configured: false, configFile };
  try {
    const configuredDirectories = parseHermesExternalDirs(await readFile(configFile, "utf8"));
    return {
      configured: configuredDirectories.some((directory) => resolve(directory) === resolve(externalSkills)),
      configFile,
    };
  } catch (error) {
    console.error(`DISCOVERY NOT VERIFIED Hermes config could not be inspected: ${error instanceof Error ? error.message : String(error)}`);
    return { configured: false, configFile };
  }
}

async function main() {
  const repoRoot = resolveRepoRoot();
  const projectSkills = join(repoRoot, ".agents", "skills");

  if (!(await isDirectory(projectSkills))) {
    console.error(`DISCOVERY NOT VERIFIED repository skill directory missing: ${projectSkills}`);
    return 1;
  }

  const repoNames = await repositorySkillNames(projectSkills);
  if (!repoNames) return 1;
  const structurallyMissing = REQUIRED_EGA_SKILLS.filter((name) => !repoNames.has(name));
  if (structurallyMissing.length) {
    console.error(`DISCOVERY NOT VERIFIED repository skill files missing: ${structurallyMissing.join(", ")}`);
    return 1;
  }
  console.log(`STRUCTURAL PASS repository contains all ${REQUIRED_EGA_SKILLS.length} required EGA skill(s): ${projectSkills}`);

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

  // Preferred modern path: repository-local project discovery, explicitly trusted by the operator.
  const trustedResult = parseJsonResult(command("hermes", ["config", "get", "skills.trusted_project_dirs", "--json"]));
  const trustedDirectories = findStringArray(trustedResult);
  const discoveryResult = parseJsonResult(command("hermes", ["config", "get", "skills.project_discovery", "--json"]));
  const projectDiscovery = findBoolean(discoveryResult);
  const projectTrusted = projectDiscovery !== false && trustedDirectories.some((directory) => resolve(directory) === resolve(repoRoot));

  // Compatibility path: explicit user-configured external directory.
  const external = await configuredExternalFallback(projectSkills);

  let provenance;
  if (projectTrusted) {
    provenance = "project";
    console.log(`Hermes project-local repository root is explicitly trusted: ${repoRoot}`);
  } else if (external.configured) {
    provenance = "external";
    console.log(`Hermes repository skill source configured as external fallback: ${projectSkills}`);
  } else {
    console.error("DISCOVERY NOT VERIFIED repository skills have no verified Hermes provenance for this profile.");
    if (projectDiscovery === false) console.error("Project-local skill discovery is disabled for this Hermes profile.");
    console.error(`Preferred explicit setup from inside the repository: hermes skills trust`);
    console.error("Compatibility fallback in ~/.hermes/config.yaml:");
    console.error("skills:\n  external_dirs:\n    - " + projectSkills);
    console.error("This preflight is read-only and will not trust the repository or edit user configuration for you.");
    return 1;
  }

  if (provenance === "external") {
    const shadows = await localShadowedSkills();
    if (shadows.length > 0) {
      for (const shadow of shadows) console.error(`DISCOVERY NOT VERIFIED user-local Hermes skill shadows external repository '${shadow.name}': ${shadow.file}`);
      return 1;
    }
  }

  const list = command("hermes", ["skills", "list"]);
  if (list.status !== 0) {
    console.error(`DISCOVERY NOT VERIFIED 'hermes skills list' exited ${list.status}: ${list.stderr.trim()}`);
    return 2;
  }

  const listing = `${list.stdout}\n${list.stderr}`;
  const missing = REQUIRED_EGA_SKILLS.filter((name) => !new RegExp(`(^|[^A-Za-z0-9_-])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9_-]|$)`, "m").test(listing));
  if (missing.length > 0) {
    console.error(`DISCOVERY NOT VERIFIED missing Hermes skills under verified ${provenance} provenance: ${missing.join(", ")}`);
    if (provenance === "project") console.error("Project trust is present but Hermes did not expose all repository skills; verify installed Hermes version/project-discovery behavior.");
    return 1;
  }

  for (const name of REQUIRED_EGA_SKILLS) console.log(`DISCOVERY VERIFIED ${provenance}-backed Hermes skill visible: ${name}`);
  console.log(`Verified repository source: ${projectSkills}`);
  console.log("RUNTIME NOT VERIFIED this preflight does not prove semantic skill selection, skill body loading, or Runner delivery behavior.");
  return 0;
}

process.exitCode = await main();
