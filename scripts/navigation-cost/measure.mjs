#!/usr/bin/env node
/**
 * Reproducible navigation-cost measurement for the authenticated web workspace.
 *
 * It records, per route:
 *  - server data/API requests made while the route is rendered (counted by a
 *    loopback proxy placed in front of the disposable Supabase API),
 *  - client First Load JS from the production Next build manifest,
 *  - Playwright cold-navigation latency (`page.goto` until the page heading is
 *    visible).
 *
 * Requirements:
 *  - a completed `npm run build --workspace @ega/web` (`.next/` present),
 *  - a disposable local backend (`node scripts/e2e/local-backend.mjs start`),
 *  - Playwright's chromium browser installed.
 *
 * The script only targets the loopback disposable environment. It refuses any
 * other Supabase or app host and never prints credentials or request headers.
 *
 * Usage:
 *   node scripts/navigation-cost/measure.mjs --label baseline
 *   node scripts/navigation-cost/measure.mjs --label after-contextual-nav \
 *     --routes /today,/tasks,/tasks/projects,/goals?view=all,/timer,/money,/review
 */
import { createRequire } from "node:module";
import { execFileSync, spawn } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { readLocalEnvironment } = require("../e2e/local-env.cjs");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const webRoot = path.join(root, "apps/web");
const APP_PORT = 3100;const PROXY_PORT = 55431;
const APP_ORIGIN = `http://127.0.0.1:${APP_PORT}`;

const DEFAULT_ROUTES = [
  "/today",
  "/tasks",
  "/tasks/projects",
  "/money",
  "/review",
  "/goals?view=all",
  "/timer",
];

function parseArgs(argv) {
  const options = {
    label: new Date().toISOString().slice(0, 10),
    routes: DEFAULT_ROUTES,
    runs: 2,
    out: null,
    keepServer: false,
    staticOnly: false,
    envFile: null,
    webDir: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === "--label") {
      options.label = value;
      index += 1;
    } else if (arg === "--routes") {
      options.routes = value.split(",").map((route) => route.trim()).filter(Boolean);
      index += 1;
    } else if (arg === "--runs") {
      options.runs = Number(value);
      index += 1;
    } else if (arg === "--out") {
      options.out = value;
      index += 1;
    } else if (arg === "--keep-server") {
      options.keepServer = true;
    } else if (arg === "--static-only") {
      options.staticOnly = true;
    } else if (arg === "--env-file") {
      options.envFile = value;
      index += 1;
    } else if (arg === "--web-dir") {
      options.webDir = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!Number.isInteger(options.runs) || options.runs < 1 || options.runs > 5) {
    throw new Error("--runs must be an integer from 1 to 5.");
  }
  if (options.routes.length === 0) throw new Error("At least one route is required.");
  for (const route of options.routes) {
    if (!route.startsWith("/") || route.startsWith("//")) {
      throw new Error(`Routes must be root-relative paths: ${route}`);
    }
  }
  const output = options.out
    ? path.resolve(root, options.out)
    : path.join(root, "docs/reports/navigation-cost", `${options.label}.json`);
  return { ...options, out: output };
}

/**
 * Next's app-build-manifest maps route entries to the chunk files they load.
 * A page's first load also includes its parent layout chunks, so include every
 * manifest entry whose normalized path is a prefix of the route.
 */
export function normalizeManifestRoute(key) {
  const withoutGroups = key.replace(/\/\([^/]+\)/g, "");
  const withoutPage = withoutGroups.replace(/\/page$/, "");
  return withoutPage.startsWith("/") ? withoutPage : `/${withoutPage}`;
}

function dynamicRouteMatches(pattern, actual) {
  const patternParts = pattern.split("/");
  const actualParts = actual.split("/");
  if (patternParts.length !== actualParts.length) return false;
  return patternParts.every(
    (part, index) =>
      part === actualParts[index] ||
      (part.startsWith("[") && part.endsWith("]") && actualParts[index].length > 0),
  );
}

async function collectFirstLoadJs(buildDir, routesToMeasure) {
  const statsPath = path.join(buildDir, "diagnostics/route-bundle-stats.json");
  if (existsSync(statsPath)) {
    const stats = JSON.parse(await readFile(statsPath, "utf8"));
    const result = {};
    for (const route of routesToMeasure) {
      const routePath = route.split("?")[0];
      const entry =
        stats.find((candidate) => candidate.route === routePath) ??
        stats.find((candidate) => dynamicRouteMatches(candidate.route, routePath));
      result[routePath] = entry
        ? {
            bytes: entry.firstLoadUncompressedJsBytes,
            kib: Math.round((entry.firstLoadUncompressedJsBytes / 1024) * 10) / 10,
            chunkCount: entry.firstLoadChunkPaths.length,
            files: entry.firstLoadChunkPaths,
          }
        : null;
    }
    return { available: true, source: ".next/diagnostics/route-bundle-stats.json", routes: result };
  }

  const manifestPath = path.join(buildDir, "app-build-manifest.json");
  if (!existsSync(manifestPath)) {
    return { available: false, reason: "No route bundle stats or app-build-manifest.json; run the web build first.", routes: {} };
  }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const pages = manifest.pages ?? {};
  const sizeCache = new Map();

  async function sizeOf(chunk) {
    if (sizeCache.has(chunk)) return sizeCache.get(chunk);
    const file = path.join(buildDir, chunk);
    let size = 0;
    try {
      size = (await readFile(file)).byteLength;
    } catch {
      size = 0;
    }
    sizeCache.set(chunk, size);
    return size;
  }

  const entries = Object.keys(pages).map((key) => ({ key, route: normalizeManifestRoute(key) }));
  const result = {};
  for (const route of routesToMeasure) {
    const routePath = route.split("?")[0];
    const chunks = new Set();
    for (const entry of entries) {
      const sameRoute = entry.route === routePath || entry.route === routePath.replace(/\/$/, "");
      const parentLayout =
        entry.key.endsWith("/layout") &&
        entry.key.startsWith("/(workspace)") &&
        routePath !== "/login" &&
        routePath !== "/signup";
      if (sameRoute || parentLayout) {
        for (const chunk of pages[entry.key] ?? []) {
          if (chunk.endsWith(".js")) chunks.add(chunk);
        }
      }
    }
    let bytes = 0;
    const files = [];
    for (const chunk of chunks) {
      const size = await sizeOf(chunk);
      bytes += size;
      files.push({ file: chunk, bytes: size });
    }
    result[routePath] = {
      bytes,
      kib: Math.round((bytes / 1024) * 10) / 10,
      chunkCount: files.length,
      files: files.sort((left, right) => right.bytes - left.bytes),
    };
  }
  return { available: true, source: ".next/app-build-manifest.json", routes: result };
}

function startCountProxy(targetUrl) {
  const target = new URL(targetUrl);
  if (!["127.0.0.1", "localhost"].includes(target.hostname)) {
    throw new Error("The measurement proxy only targets a loopback Supabase API.");
  }
  let counters = { rest: 0, auth: 0, other: 0, byTable: {} };

  const server = createServer((incoming, outgoing) => {
    const pathname = (incoming.url ?? "/").split("?")[0];
    if (pathname.startsWith("/rest/v1/")) {
      const table = pathname.slice("/rest/v1/".length).split("/")[0] || "rpc";
      counters.rest += 1;
      counters.byTable[table] = (counters.byTable[table] ?? 0) + 1;
    } else if (pathname.startsWith("/auth/v1/")) {
      counters.auth += 1;
    } else {
      counters.other += 1;
    }

    const headers = { ...incoming.headers, host: target.host };
    delete headers["accept-encoding"];
    const upstream = httpRequest(
      {
        hostname: target.hostname,
        port: target.port || 80,
        method: incoming.method,
        path: incoming.url,
        headers,
      },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      },
    );
    upstream.on("error", () => {
      if (!outgoing.headersSent) outgoing.writeHead(502);
      outgoing.end();
    });
    incoming.pipe(upstream);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PROXY_PORT, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${PROXY_PORT}`,
        reset() {
          counters = { rest: 0, auth: 0, other: 0, byTable: {} };
        },
        snapshot() {
          return JSON.parse(JSON.stringify(counters));
        },
        close() {
          return new Promise((done) => {
            server.closeAllConnections?.();
            server.close(() => done());
          });
        },
      });
    });
  });
}

function waitForServer(url, timeoutMs = 120_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      try {
        const response = await fetch(url, { redirect: "manual" });
        if (response.status < 500) return resolve();
      } catch {
        // Server is still starting.
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error("Timed out waiting for the production server."));
        return;
      }
      setTimeout(attempt, 500);
    };
    void attempt();
  });
}

function spawnNext(env, webDir) {
  const child = spawn(
    process.execPath,
    [path.join(root, "node_modules/next/dist/bin/next"), "start", "--port", String(APP_PORT), "--hostname", "127.0.0.1"],
    {
      cwd: webDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  const capture = (chunk) => {
    output = `${output}${chunk.toString()}`.slice(-4000);
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`Production server exited with ${code}: ${output.slice(-800)}`);
    }
  });
  return child;
}

async function seedOwner(env) {
  const { createClient } = await import("@supabase/supabase-js");
  const postgres = (await import("postgres")).default;
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `${env.E2E_RUN_ID}-nav-cost-${Date.now()}@example.test`;
  const password = `nav-cost-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error("Unable to create the measurement owner.");
  const ownerId = data.user.id;
  const slug = `nav-cost-${Date.now()}`;
  const sql = postgres(env.DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    await sql`INSERT INTO user_preferences (user_id) VALUES (${ownerId})`;
    await sql`INSERT INTO user_time_context (user_id, iana_timezone) VALUES (${ownerId}, 'Africa/Casablanca')`;
    const project = await sql`
      INSERT INTO projects (name, slug, owner_user_id) VALUES ('Navigation cost workspace', ${slug}, ${ownerId})
      RETURNING id
    `;
    const projectId = project[0].id;
    await sql`
      INSERT INTO goals (owner_user_id, project_id, title, status, health, next_step)
      VALUES (${ownerId}, ${projectId}, 'Keep the workspace navigable', 'active', 'on_track', 'Measure before changing navigation')
    `;
    await sql`
      INSERT INTO tasks (owner_user_id, project_id, title, status, priority, focus_rank)
      VALUES
        (${ownerId}, ${projectId}, 'Measure navigation cost', 'in_progress', 'high', 1),
        (${ownerId}, ${projectId}, 'Review the result', 'todo', 'medium', 2)
    `;
  } finally {
    await sql.end({ timeout: 5 });
  }
  return {
    owner: { id: ownerId, email, password },
    projectSlug: slug,
    cleanup: async () => {
      const cleanup = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      await cleanup.auth.admin.deleteUser(ownerId).catch(() => {});
    },
  };
}

async function signInWithCookies(context, env, owner, baseUrl) {
  const { createServerClient } = await import("@supabase/ssr");
  const cookies = [];
  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => [],
        setAll: (nextCookies) => cookies.push(...nextCookies),
      },
    },
  );
  const { error } = await supabase.auth.signInWithPassword({
    email: owner.email,
    password: owner.password,
  });
  if (error) throw new Error("Unable to create an authenticated measurement session.");
  if (cookies.length === 0) throw new Error("Supabase did not issue a session cookie.");
  await context.addCookies(
    cookies.map(({ name, value }) => ({ name, value, url: baseUrl })),
  );
}

async function readMeasurementEnv(envFile) {
  if (!envFile) return readLocalEnvironment();
  const value = JSON.parse(await readFile(path.resolve(root, envFile), "utf8"));
  const supabase = new URL(value.NEXT_PUBLIC_SUPABASE_URL);
  const database = new URL(value.DATABASE_URL);
  if (supabase.protocol !== "http:" || supabase.hostname !== "127.0.0.1") {
    throw new Error("The measurement Supabase API must be loopback HTTP.");
  }
  if (database.protocol !== "postgresql:" || database.hostname !== "127.0.0.1") {
    throw new Error("The measurement database must be loopback PostgreSQL.");
  }
  return value;
}

function gitValue(args, cwd) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function gitCommit(cwd) {
  return gitValue(["rev-parse", "HEAD"], cwd);
}

function gitDirty(cwd) {
  const status = gitValue(["status", "--porcelain"], cwd);
  return status === null ? null : status.length > 0;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

async function writeReport(options, firstLoadJs, routes, runtime, commit) {
  const report = {
    generatedAt: new Date().toISOString(),
    label: options.label,
    commit,
    dirty: runtime.webDirty ?? null,
    baseUrl: runtime.measured ? APP_ORIGIN : null,
    runtime,
    routes,
    firstLoadJs,
    notes: [
      "serverRestRequests counts HTTP requests the Next server makes to PostgREST through a loopback counting proxy.",
      "serverAuthRequests counts server requests to Supabase Auth (session/claims/user lookups).",
      "navigationMs is Playwright page.goto wall time until the first h1 is visible (domcontentloaded + 500 ms settle; realtime subscriptions prevent networkidle).",
      "firstLoadJsKib is the route's first-load JS emitted by the Next build (Turbopack route bundle stats, with an app-build-manifest fallback).",
    ],
  };
  await mkdir(path.dirname(options.out), { recursive: true });
  await writeFile(options.out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Wrote ${path.relative(root, options.out)}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const webDir = options.webDir ? path.resolve(root, options.webDir) : webRoot;
  const buildDir = path.join(webDir, ".next");
  if (!existsSync(buildDir)) {
    throw new Error("Missing .next. Build the web workspace before measuring.");
  }
  const firstLoadJs = await collectFirstLoadJs(buildDir, options.routes);
  const commit = gitCommit(webDir);
  const webDirty = gitDirty(webDir);
  if (options.staticOnly) {
    await writeReport(options, firstLoadJs, [], {
      measured: false,
      reason: "--static-only: runtime navigation metrics were not collected.",
      webDirty,
    }, commit);
    return;
  }

  const env = await readMeasurementEnv(options.envFile);
  const { chromium } = await import("@playwright/test");
  const ownerFixture = await seedOwner(env);
  const proxy = await startCountProxy(env.NEXT_PUBLIC_SUPABASE_URL);
  let nextProcess = null;
  let browser = null;
  try {
    const serverEnv = {
      ...process.env,
      ...env,
      NEXT_PUBLIC_SUPABASE_URL: proxy.url,
      NEXT_PUBLIC_SITE_URL: APP_ORIGIN,
      NODE_ENV: "production",
    };
    nextProcess = spawnNext(serverEnv, webDir);
    await waitForServer(`${APP_ORIGIN}/login`);

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      timezoneId: "Africa/Casablanca",
    });
    const page = await context.newPage();
    await signInWithCookies(context, env, ownerFixture.owner, APP_ORIGIN);

    // Warm the production runtime once so the first measured route is not
    // charged with process start-up that only exists in this harness. Realtime
    // subscriptions keep the network busy, so never wait for network idle.
    await page.goto(`${APP_ORIGIN}/today`, { waitUntil: "domcontentloaded" });
    await page.locator("h1").first().waitFor({ state: "visible" });
    if (new URL(page.url()).pathname === "/login") {
      throw new Error("The measurement session was not accepted by the production server.");
    }

    const routes = [];
    for (const route of options.routes) {
      const durations = [];
      const samples = [];
      for (let run = 0; run < options.runs; run += 1) {
        proxy.reset();
        const started = Date.now();
        await page.goto(`${APP_ORIGIN}${route}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
        await page.locator("h1").first().waitFor({ state: "visible", timeout: 30_000 });
        await page.waitForTimeout(500);
        durations.push(Date.now() - started);
        samples.push(proxy.snapshot());
      }
      const restCounts = samples.map((sample) => sample.rest);
      const authCounts = samples.map((sample) => sample.auth);
      const tables = {};
      for (const sample of samples) {
        for (const [table, count] of Object.entries(sample.byTable)) {
          tables[table] = Math.max(tables[table] ?? 0, count);
        }
      }
      routes.push({
        route,
        serverRestRequests: median(restCounts),
        serverRestRequestsSamples: restCounts,
        serverAuthRequests: median(authCounts),
        serverAuthRequestsSamples: authCounts,
        serverTables: tables,
        navigationMs: durations,
        medianNavigationMs: median(durations),
        firstLoadJsKib: firstLoadJs.routes[route.split("?")[0]]?.kib ?? null,
      });
      const latest = routes[routes.length - 1];
      console.log(
        `${route.padEnd(34)} rest=${String(latest.serverRestRequests).padStart(2)} auth=${String(latest.serverAuthRequests).padStart(2)} ` +
          `median=${String(latest.medianNavigationMs).padStart(5)}ms firstLoad=${latest.firstLoadJsKib ?? "?"}KiB`,
      );
    }

    const report = {
      generatedAt: new Date().toISOString(),
      label: options.label,
      commit,
      dirty: webDirty,
      baseUrl: APP_ORIGIN,
      runtime: { measured: true },
      routes,
      firstLoadJs,
      notes: [
        "serverRestRequests counts HTTP requests the Next server makes to PostgREST through a loopback counting proxy.",
        "serverAuthRequests counts server requests to Supabase Auth (session/claims/user lookups).",
        "navigationMs is Playwright page.goto wall time until the first h1 is visible (domcontentloaded + 500 ms settle; realtime subscriptions prevent networkidle).",
        "firstLoadJsKib is the route's first-load JS emitted by the Next build (Turbopack route bundle stats, with an app-build-manifest fallback).",
      ],
    };
    await mkdir(path.dirname(options.out), { recursive: true });
    await writeFile(options.out, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Wrote ${path.relative(root, options.out)}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (nextProcess && !options.keepServer) nextProcess.kill("SIGTERM");
    await proxy.close();
    await ownerFixture.cleanup();
  }
}

export { collectFirstLoadJs, median };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Navigation cost measurement failed: ${error.message}`);
    process.exitCode = 1;
  });
}
