import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const SOURCE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
]);

const PACKAGE = (value) => ({ kind: "package", value });
const REPO_PATH = (value) => ({ kind: "repo-path", value });
const SPECIFIER = (value) => ({ kind: "specifier", value });

export const BOUNDARY_RULES = [
  {
    id: "mobile-no-application",
    from: ["apps/mobile/"],
    forbidden: [PACKAGE("@ega/application")],
  },
  {
    id: "mobile-no-data-access",
    from: ["apps/mobile/"],
    forbidden: [PACKAGE("@ega/data-access")],
  },
  {
    id: "mobile-no-server",
    from: ["apps/mobile/"],
    forbidden: [REPO_PATH("apps/server/"), SPECIFIER("apps/server")],
  },
  {
    id: "mobile-no-web",
    from: ["apps/mobile/"],
    forbidden: [REPO_PATH("apps/web/"), REPO_PATH("src/")],
  },
  {
    id: "mobile-no-db",
    from: ["apps/mobile/"],
    forbidden: [REPO_PATH("src/db/"), REPO_PATH("apps/web/src/db/")],
  },
  {
    id: "mobile-no-server-supabase",
    from: ["apps/mobile/"],
    forbidden: [
      SPECIFIER("@/lib/supabase/server"),
      REPO_PATH("src/lib/supabase/server"),
      REPO_PATH("apps/web/src/lib/supabase/server"),
    ],
  },
  {
    id: "contracts-platform-neutral",
    from: ["packages/contracts/"],
    forbidden: [
      PACKAGE("react"),
      PACKAGE("react-native"),
      PACKAGE("next"),
      PACKAGE("@supabase/ssr"),
      PACKAGE("@supabase/supabase-js"),
      PACKAGE("drizzle-orm"),
      PACKAGE("drizzle-kit"),
    ],
  },
  {
    id: "domain-platform-neutral",
    from: ["packages/domain/"],
    forbidden: [
      PACKAGE("react"),
      PACKAGE("react-native"),
      PACKAGE("next"),
      PACKAGE("@supabase/ssr"),
      PACKAGE("@supabase/supabase-js"),
      PACKAGE("drizzle-orm"),
      PACKAGE("drizzle-kit"),
    ],
  },
  {
    id: "api-client-platform-neutral",
    from: ["packages/api-client/"],
    forbidden: [
      PACKAGE("expo"),
      PACKAGE("react"),
      PACKAGE("react-native"),
      PACKAGE("next"),
      PACKAGE("@supabase/ssr"),
      PACKAGE("@supabase/supabase-js"),
      PACKAGE("@ega/application"),
      PACKAGE("@ega/data-access"),
      REPO_PATH("apps/"),
      REPO_PATH("src/db/"),
    ],
  },
];

function normalizeRepoPath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

function packageMatches(specifier, packageName) {
  return specifier === packageName || specifier.startsWith(`${packageName}/`);
}

function specifierMatches(specifier, expected) {
  return specifier === expected || specifier.startsWith(`${expected}/`);
}

function workspaceAliasRoot(filePath) {
  if (filePath.startsWith("apps/mobile/")) return "apps/mobile";
  if (filePath.startsWith("apps/web/")) return "apps/web/src";
  return "src";
}

function resolveRepositoryImport(filePath, specifier) {
  if (specifier.startsWith("@/")) {
    return normalizeRepoPath(path.posix.join(workspaceAliasRoot(filePath), specifier.slice(2)));
  }

  if (!specifier.startsWith(".")) {
    return null;
  }

  return normalizeRepoPath(path.posix.normalize(path.posix.join(path.posix.dirname(filePath), specifier)));
}

function repoPathMatches(resolvedPath, expected) {
  if (!resolvedPath) return false;
  const normalizedExpected = normalizeRepoPath(expected).replace(/\/$/, "");
  return resolvedPath === normalizedExpected || resolvedPath.startsWith(`${normalizedExpected}/`);
}

function matcherMatches(matcher, specifier, resolvedPath) {
  switch (matcher.kind) {
    case "package":
      return packageMatches(specifier, matcher.value);
    case "specifier":
      return specifierMatches(specifier, matcher.value);
    case "repo-path":
      return repoPathMatches(resolvedPath, matcher.value);
    default:
      throw new Error(`Unknown architecture matcher kind: ${matcher.kind}`);
  }
}

function literalModuleSpecifier(node) {
  if (ts.isStringLiteralLike(node)) return node.text;
  return null;
}

export function collectImportSpecifiers(sourceText, filePath = "fixture.ts") {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") || filePath.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const specifiers = [];

  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const specifier = node.moduleSpecifier ? literalModuleSpecifier(node.moduleSpecifier) : null;
      if (specifier) specifiers.push(specifier);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const expression = node.moduleReference.expression;
      const specifier = expression ? literalModuleSpecifier(expression) : null;
      if (specifier) specifiers.push(specifier);
    } else if (ts.isCallExpression(node) && node.arguments.length === 1) {
      const argument = literalModuleSpecifier(node.arguments[0]);
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      if (argument && (isRequire || isDynamicImport)) specifiers.push(argument);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}

export function checkSourceText(filePath, sourceText, rules = BOUNDARY_RULES) {
  const normalizedFilePath = normalizeRepoPath(filePath);
  const diagnostics = [];

  for (const specifier of collectImportSpecifiers(sourceText, normalizedFilePath)) {
    const resolvedPath = resolveRepositoryImport(normalizedFilePath, specifier);

    for (const rule of rules) {
      if (!rule.from.some((prefix) => normalizedFilePath.startsWith(prefix))) continue;
      if (!rule.forbidden.some((matcher) => matcherMatches(matcher, specifier, resolvedPath))) continue;

      diagnostics.push(`${normalizedFilePath}: forbidden import "${specifier}" [${rule.id}]`);
      break;
    }
  }

  return diagnostics;
}

export function listTrackedSourceFiles(cwd = process.cwd()) {
  const output = execFileSync("git", ["ls-files", "-z"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  return output
    .split("\0")
    .filter(Boolean)
    .map(normalizeRepoPath)
    .filter((filePath) => SOURCE_EXTENSIONS.has(path.posix.extname(filePath)));
}

export function checkRepository(cwd = process.cwd(), rules = BOUNDARY_RULES) {
  const diagnostics = [];

  for (const filePath of listTrackedSourceFiles(cwd)) {
    const sourceText = readFileSync(path.join(cwd, filePath), "utf8");
    diagnostics.push(...checkSourceText(filePath, sourceText, rules));
  }

  return diagnostics;
}

function isDirectExecution() {
  if (!process.argv[1]) return false;
  return path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
}

if (isDirectExecution()) {
  const diagnostics = checkRepository(process.cwd());
  if (diagnostics.length > 0) {
    for (const diagnostic of diagnostics) console.error(diagnostic);
    process.exitCode = 1;
  }
}
