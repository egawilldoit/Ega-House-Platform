import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { readFile, stat } from "node:fs/promises";

const ts = createRequire(import.meta.url)("typescript");
export const DEFAULT_PROJECT_DOC_MAX_BYTES = 32 * 1024;
export const REQUIRED_EGA_SKILLS = [
  "code-review", "code-truth-audit", "database-evidence",
  "final-verification", "issue-implementation",
];

const fileExists = async (file) => {
  try { return (await stat(file)).isFile(); } catch { return false; }
};

const stripIndent = (lines) => {
  const nonEmpty = lines.filter((line) => line.trim());
  const indent = nonEmpty.length ? Math.min(...nonEmpty.map((line) => line.match(/^\s*/)[0].length)) : 0;
  return lines.map((line) => line.trim() ? line.slice(indent) : "");
};

const fold = (lines) => {
  const paragraphs = [];
  let current = [];
  for (const line of lines) {
    if (line) current.push(line);
    else if (current.length) { paragraphs.push(current.join(" ")); current = []; }
  }
  if (current.length) paragraphs.push(current.join(" "));
  return paragraphs.join("\n");
};

function quoted(value, file, key) {
  if (value.startsWith('"')) {
    try { return JSON.parse(value); }
    catch (error) { throw new Error(`${file}: invalid quoted scalar for '${key}' (${error.message})`); }
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'")) throw new Error(`${file}: unterminated quoted scalar for '${key}'`);
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

/** Bounded YAML frontmatter parser for scalar metadata used by SKILL.md. */
export function parseSkillFrontmatter(content, file = "<skill>") {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines[0]?.trim() !== "---") throw new Error(`${file}: missing opening YAML frontmatter delimiter`);
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end < 0) throw new Error(`${file}: missing closing YAML frontmatter delimiter`);
  const source = lines.slice(1, end);
  const fields = {};

  for (let index = 0; index < source.length;) {
    const line = source[index];
    if (!line.trim() || line.trimStart().startsWith("#")) { index += 1; continue; }
    if (/^\s/.test(line)) throw new Error(`${file}: unexpected indented frontmatter line ${index + 2}`);
    const match = line.match(/^([A-Za-z0-9_.-]+):(?:\s*(.*))?$/);
    if (!match) throw new Error(`${file}: malformed frontmatter line ${index + 2}`);
    const [, key, raw = ""] = match;
    const block = raw.match(/^([>|])(?:[+-]?)(?:\d+)?\s*(?:#.*)?$/);
    index += 1;
    const continuation = [];
    while (index < source.length && (!source[index].trim() || /^\s/.test(source[index]))) continuation.push(source[index++]);
    if (block) {
      const normalized = stripIndent(continuation);
      fields[key] = block[1] === ">" ? fold(normalized) : normalized.join("\n").trimEnd();
    } else {
      const scalar = quoted(raw.trim(), file, key);
      const extra = stripIndent(continuation).join("\n").trimEnd();
      fields[key] = extra ? `${scalar}${scalar ? "\n" : ""}${extra}` : scalar;
    }
  }
  return { fields, bodyStartLine: end + 2 };
}

export function validateSkillDocuments(documents) {
  const errors = [];
  const names = new Map();
  for (const { file, content } of documents) {
    let fields;
    try { fields = parseSkillFrontmatter(content, file).fields; }
    catch (error) { errors.push(error.message); continue; }
    const name = typeof fields.name === "string" ? fields.name.trim() : "";
    const description = typeof fields.description === "string" ? fields.description.trim() : "";
    if (!name) errors.push(`${file}: frontmatter 'name' must be a non-empty string`);
    if (description.length < 20 || description === ">" || description === "|") errors.push(`${file}: frontmatter 'description' must be a meaningful non-empty string`);
    if (name && names.has(name)) errors.push(`duplicate skill name '${name}': ${names.get(name)} and ${file}`);
    else if (name) names.set(name, file);
  }
  return errors;
}

export function findExecutablePgmqPopCalls(source, file = "source.ts") {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : /\.(m?js)$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const findings = [];
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const target = node.expression;
      const owner = ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target) ? target.expression : null;
      const name = ts.isPropertyAccessExpression(target) ? target.name.text
        : ts.isElementAccessExpression(target) && ts.isStringLiteralLike(target.argumentExpression) ? target.argumentExpression.text : null;
      if (owner && ts.isIdentifier(owner) && owner.text === "pgmq" && name === "pop") {
        const point = ast.getLineAndCharacterOfPosition(target.getStart(ast));
        findings.push({ file, line: point.line + 1, column: point.character + 1 });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return findings;
}

export function resolveMarkdownTarget(repoRoot, markdownFile, target) {
  const value = target.trim();
  if (!value || value.startsWith("#") || /^(https?:|mailto:|tel:|ftp:|slack:)/i.test(value)) return null;
  const clean = value.split("#", 1)[0].split("?", 1)[0];
  if (!clean) return null;
  return clean.startsWith("/") ? resolve(repoRoot, `.${clean}`) : resolve(dirname(resolve(repoRoot, markdownFile)), clean);
}

export function parseCodexConfig(content) {
  const max = content.match(/^\s*project_doc_max_bytes\s*=\s*(\d+)\s*(?:#.*)?$/m);
  const list = content.match(/^\s*project_doc_fallback_filenames\s*=\s*\[([\s\S]*?)\]/m)?.[1] ?? "";
  const fallbackFilenames = [...list.matchAll(/"((?:\\.|[^"\\])*)"|'((?:''|[^'])*)'/g)]
    .map((match) => match[1] !== undefined ? JSON.parse(`"${match[1]}"`) : match[2].replace(/''/g, "'"));
  return { projectDocMaxBytes: max ? Number(max[1]) : undefined, fallbackFilenames };
}

export async function loadCodexDiscoveryConfig({ repoRoot, env = process.env, userHome = homedir() }) {
  const codexHome = env.CODEX_HOME ? resolve(env.CODEX_HOME) : join(userHome, ".codex");
  const candidates = [join(codexHome, "config.toml"), join(repoRoot, ".codex", "config.toml")];
  const result = { projectDocMaxBytes: DEFAULT_PROJECT_DOC_MAX_BYTES, fallbackFilenames: [], inspectedConfigFiles: [] };
  for (const file of candidates) {
    if (!(await fileExists(file))) continue;
    const parsed = parseCodexConfig(await readFile(file, "utf8"));
    result.inspectedConfigFiles.push(file);
    if (Number.isSafeInteger(parsed.projectDocMaxBytes) && parsed.projectDocMaxBytes > 0) result.projectDocMaxBytes = parsed.projectDocMaxBytes;
    if (parsed.fallbackFilenames.length) result.fallbackFilenames = parsed.fallbackFilenames;
  }
  return result;
}

function pathDirectories(repoRoot, cwd) {
  const root = resolve(repoRoot);
  const target = resolve(cwd);
  const rel = relative(root, target);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`working directory is outside repository root: ${target}`);
  const directories = [root];
  let current = root;
  for (const part of rel ? rel.split(sep) : []) { current = join(current, part); directories.push(current); }
  return directories;
}

export async function discoverCodexInstructionChain({ repoRoot, workingDirectory, fallbackFilenames = [], projectDocMaxBytes = DEFAULT_PROJECT_DOC_MAX_BYTES }) {
  const selectedFiles = [];
  const fallbacks = fallbackFilenames.filter((name, index, all) => name && !["AGENTS.override.md", "AGENTS.md"].includes(name) && all.indexOf(name) === index);
  for (const directory of pathDirectories(repoRoot, workingDirectory)) {
    for (const name of ["AGENTS.override.md", "AGENTS.md", ...fallbacks]) {
      const file = join(directory, name);
      if (!(await fileExists(file))) continue;
      const bytes = Buffer.byteLength(await readFile(file, "utf8"), "utf8");
      selectedFiles.push({ path: file, bytes });
      break;
    }
  }
  const combinedBytes = selectedFiles.reduce((sum, file) => sum + file.bytes, 0);
  return { workingDirectory: resolve(workingDirectory), selectedFiles, combinedBytes, projectDocMaxBytes, withinBudget: combinedBytes <= projectDocMaxBytes };
}
