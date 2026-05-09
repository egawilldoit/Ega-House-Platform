import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const SONAR_HOST = "https://sonarcloud.io";
const PROJECT_KEY = "MORTAKI0_Ega-House-Platform";
const BRANCH = "main";
const PAGE_SIZE = 500;

const REPORTS_DIR = path.resolve(process.cwd(), "reports");
const JSON_OUTPUT_PATH = path.join(REPORTS_DIR, "sonar-reliability-issues.json");
const CSV_OUTPUT_PATH = path.join(REPORTS_DIR, "sonar-reliability-issues.csv");

const CSV_COLUMNS = [
  "issueKey",
  "severity",
  "cleanCodeAttribute",
  "softwareQuality",
  "impactSeverity",
  "type",
  "rule",
  "component",
  "filePath",
  "line",
  "message",
  "effort",
  "status",
  "creationDate",
  "updateDate",
  "issueUrl",
];

function getToken() {
  const token = process.env.SONAR_TOKEN?.trim();
  if (!token) {
    console.error("Missing SONAR_TOKEN environment variable. Set SONAR_TOKEN and re-run the script.");
    process.exit(1);
  }

  return token;
}

function parseFilePath(component) {
  if (!component || typeof component !== "string") return "";
  const parts = component.split(":");
  return parts.length > 1 ? parts.slice(1).join(":") : component;
}

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function getReliabilityImpact(issue) {
  if (!Array.isArray(issue?.impacts)) return null;
  return issue.impacts.find((impact) => impact?.softwareQuality === "RELIABILITY") ?? null;
}

function buildIssueUrl(issueKey) {
  return `${SONAR_HOST}/project/issues?open=${encodeURIComponent(issueKey)}&id=${encodeURIComponent(PROJECT_KEY)}`;
}

function mapIssue(issue) {
  const reliabilityImpact = getReliabilityImpact(issue);
  return {
    issueKey: issue.key ?? "",
    severity: issue.severity ?? "",
    cleanCodeAttribute: issue.cleanCodeAttribute ?? "",
    softwareQuality: reliabilityImpact?.softwareQuality ?? "",
    impactSeverity: reliabilityImpact?.severity ?? "",
    type: issue.type ?? "",
    rule: issue.rule ?? "",
    component: issue.component ?? "",
    filePath: parseFilePath(issue.component),
    line: issue.line ?? "",
    message: issue.message ?? "",
    effort: issue.effort ?? "",
    status: issue.status ?? "",
    creationDate: issue.creationDate ?? "",
    updateDate: issue.updateDate ?? "",
    issueUrl: buildIssueUrl(issue.key ?? ""),
  };
}

function toCsv(rows) {
  const header = CSV_COLUMNS.join(",");
  const lines = rows.map((row) => CSV_COLUMNS.map((column) => csvEscape(row[column])).join(","));
  return `${header}\n${lines.join("\n")}\n`;
}

function isUnsupportedImpactSoftwareQualitiesError(errorPayload) {
  const errors = Array.isArray(errorPayload?.errors) ? errorPayload.errors : [];
  return errors.some((entry) => {
    const msg = entry?.msg;
    return typeof msg === "string" && msg.toLowerCase().includes("impactsoftwarequalities");
  });
}

async function fetchIssuesPage({ token, page, includeImpactSoftwareQualities }) {
  const params = new URLSearchParams({
    projectKeys: PROJECT_KEY,
    branch: BRANCH,
    statuses: "OPEN,CONFIRMED,REOPENED",
    ps: String(PAGE_SIZE),
    p: String(page),
  });

  if (includeImpactSoftwareQualities) params.set("impactSoftwareQualities", "RELIABILITY");

  const response = await fetch(`${SONAR_HOST}/api/issues/search?${params.toString()}`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${token}:`).toString("base64")}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    let payload;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    const error = new Error(`SonarCloud API request failed (${response.status} ${response.statusText}) for page ${page}.`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return response.json();
}

async function fetchAllIssues(token) {
  const issues = [];
  let page = 1;
  let usesImpactSoftwareQualities = true;

  while (true) {
    let data;

    try {
      data = await fetchIssuesPage({ token, page, includeImpactSoftwareQualities: usesImpactSoftwareQualities });
    } catch (error) {
      const shouldFallback =
        page === 1 &&
        usesImpactSoftwareQualities &&
        Number(error.status) === 400 &&
        isUnsupportedImpactSoftwareQualitiesError(error.payload);

      if (shouldFallback) {
        console.warn("impactSoftwareQualities is not supported. Falling back to client-side RELIABILITY filtering.");
        usesImpactSoftwareQualities = false;
        continue;
      }

      throw error;
    }

    const pageIssues = Array.isArray(data.issues) ? data.issues : [];
    const total = Number(data.total) || 0;
    issues.push(...pageIssues);

    if (issues.length >= total || pageIssues.length === 0) break;
    page += 1;
  }

  return { issues, usesImpactSoftwareQualities };
}

function summarize(rows) {
  const severityCounts = rows.reduce((acc, row) => {
    const key = row.impactSeverity || "UNKNOWN";
    acc.set(key, (acc.get(key) ?? 0) + 1);
    return acc;
  }, new Map());

  const fileCounts = rows.reduce((acc, row) => {
    const key = row.filePath || "(unknown file)";
    acc.set(key, (acc.get(key) ?? 0) + 1);
    return acc;
  }, new Map());

  const topFiles = [...fileCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  return { severityCounts, topFiles };
}

async function main() {
  const token = getToken();
  await mkdir(REPORTS_DIR, { recursive: true });

  const { issues, usesImpactSoftwareQualities } = await fetchAllIssues(token);
  const reliabilityIssues = usesImpactSoftwareQualities
    ? issues
    : issues.filter((issue) => getReliabilityImpact(issue) !== null);

  const exportedRows = reliabilityIssues.map(mapIssue);

  await Promise.all([
    writeFile(JSON_OUTPUT_PATH, `${JSON.stringify(exportedRows, null, 2)}\n`, "utf8"),
    writeFile(CSV_OUTPUT_PATH, toCsv(exportedRows), "utf8"),
  ]);

  const { severityCounts, topFiles } = summarize(exportedRows);

  console.log(`Exported Reliability issues: ${exportedRows.length}`);
  console.log("Count by impact severity:");
  if (severityCounts.size === 0) {
    console.log("  (none)");
  } else {
    for (const [severity, count] of [...severityCounts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${severity}: ${count}`);
    }
  }

  console.log("Top 10 files with most Reliability issues:");
  if (topFiles.length === 0) {
    console.log("  (none)");
  } else {
    for (const [file, count] of topFiles) {
      console.log(`  ${count.toString().padStart(4, " ")}  ${file}`);
    }
  }

  console.log(`JSON report: ${JSON_OUTPUT_PATH}`);
  console.log(`CSV report: ${CSV_OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error?.message || "Unexpected error while exporting SonarCloud issues.");
  if (error?.payload?.errors) {
    for (const apiError of error.payload.errors) {
      if (apiError?.msg) console.error(`SonarCloud API error: ${apiError.msg}`);
    }
  }
  process.exit(1);
});
