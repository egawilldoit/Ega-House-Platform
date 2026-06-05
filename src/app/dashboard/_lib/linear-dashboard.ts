import "server-only";

const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";
const LINEAR_PROJECT_NAME_FALLBACK = "EGA House Platform";
const LINEAR_TIMEOUT_MS = 5000;
const MAX_MILESTONES = 6;
const MAX_ISSUES = 250;

type LinearGraphQLError = {
  message?: string;
};

type LinearGraphQLResponse<T> = {
  data?: T;
  errors?: LinearGraphQLError[];
};

export type LinearMilestoneSnapshot = {
  id: string;
  name: string;
  targetDate: string | null;
  progressPercent: number | null;
};

export type LinearIssueStatusCount = {
  state: string;
  count: number;
};

export type LinearProjectSnapshot = {
  id: string;
  name: string;
  url: string | null;
  status: string | null;
  targetDate: string | null;
  priority: string | null;
  updatedAt: string;
  milestones: LinearMilestoneSnapshot[];
  issueStatusCounts: LinearIssueStatusCount[];
};

type ProjectByStatusFieldResponse = {
  projects?: {
    nodes?: Array<{
      id?: string;
      name?: string;
      url?: string | null;
      targetDate?: string | null;
      updatedAt?: string;
      priority?: number | null;
      status?: {
        name?: string | null;
      } | null;
    }>;
  };
};

type ProjectByStateFieldResponse = {
  projects?: {
    nodes?: Array<{
      id?: string;
      name?: string;
      url?: string | null;
      targetDate?: string | null;
      updatedAt?: string;
      priority?: number | null;
      state?: string | null;
    }>;
  };
};

type ProjectMilestonesRootResponse = {
  projectMilestones?: {
    nodes?: Array<{
      id?: string;
      name?: string;
      targetDate?: string | null;
      progress?: number | string | null;
    }>;
  };
};

type ProjectMilestonesNestedResponse = {
  projects?: {
    nodes?: Array<{
      milestones?: {
        nodes?: Array<{
          id?: string;
          name?: string;
          targetDate?: string | null;
          progress?: number | string | null;
        }>;
      } | null;
    }>;
  };
};

type ProjectIssuesResponse = {
  issues?: {
    nodes?: Array<{
      state?: {
        name?: string | null;
      } | null;
    }>;
  };
};

function readLinearToken() {
  const token =
    process.env.LINEAR_API_KEY?.trim() ||
    process.env.LINEAR_ACCESS_TOKEN?.trim() ||
    process.env.LINEAR_TOKEN?.trim();

  if (!token) {
    throw new Error(
      "Linear API token is not configured (set LINEAR_API_KEY, LINEAR_ACCESS_TOKEN, or LINEAR_TOKEN).",
    );
  }

  return token;
}

function readLinearProjectName() {
  const configured = process.env.LINEAR_PROJECT_NAME?.trim();
  if (configured && configured.length > 0) {
    return configured;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "LINEAR_PROJECT_NAME env var is required in production (set it to your Linear project name).",
    );
  }

  return LINEAR_PROJECT_NAME_FALLBACK;
}

async function linearGraphQL<T>(
  query: string,
  variables: Record<string, string | number | boolean | null>,
): Promise<T> {
  const token = readLinearToken();
  const response = await fetch(LINEAR_GRAPHQL_URL, {
    method: "POST",
    cache: "no-store",
    signal: AbortSignal.timeout(LINEAR_TIMEOUT_MS),
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
    },
    body: JSON.stringify({
      query,
      variables,
    }),
  });

  if (!response.ok) {
    throw new Error(`Linear request failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as LinearGraphQLResponse<T>;
  if (payload.errors?.length) {
    const message =
      payload.errors[0]?.message?.trim() || "Linear GraphQL query failed.";
    throw new Error(message);
  }

  if (!payload.data) {
    throw new Error("Linear GraphQL query returned no data.");
  }

  return payload.data;
}

function normalizePriority(priority: number | null | undefined) {
  if (!Number.isFinite(priority)) {
    return null;
  }

  switch (priority) {
    case 1:
      return "Urgent";
    case 2:
      return "High";
    case 3:
      return "Medium";
    case 4:
      return "Low";
    default:
      return "No priority";
  }
}

function normalizeProgressPercent(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1) {
      return Math.max(0, Math.min(100, Math.round(value)));
    }

    return Math.max(0, Math.min(100, Math.round(value * 100)));
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed.replace("%", ""));
  if (!Number.isFinite(parsed)) {
    return null;
  }

  if (parsed > 1) {
    return Math.max(0, Math.min(100, Math.round(parsed)));
  }

  return Math.max(0, Math.min(100, Math.round(parsed * 100)));
}

function normalizeMilestones(
  milestones:
    | Array<{
        id?: string;
        name?: string;
        targetDate?: string | null;
        progress?: number | string | null;
      }>
    | undefined,
) {
  return (milestones ?? [])
    .map((milestone) => ({
      id: milestone.id?.trim() ?? "",
      name: milestone.name?.trim() ?? "",
      targetDate: milestone.targetDate ?? null,
      progressPercent: normalizeProgressPercent(milestone.progress),
    }))
    .filter((milestone) => milestone.id && milestone.name)
    .sort((left, right) => {
      const leftProgress = left.progressPercent ?? -1;
      const rightProgress = right.progressPercent ?? -1;
      return rightProgress - leftProgress;
    })
    .slice(0, MAX_MILESTONES);
}

async function getProjectFromStatusField(): Promise<{
  id: string;
  name: string;
  url: string | null;
  status: string | null;
  targetDate: string | null;
  priority: string | null;
  updatedAt: string;
} | null> {
  const data = await linearGraphQL<ProjectByStatusFieldResponse>(
    `
      query DashboardProjectByStatus($projectName: String!) {
        projects(filter: { name: { eq: $projectName } }, first: 1) {
          nodes {
            id
            name
            url
            targetDate
            updatedAt
            priority
            status {
              name
            }
          }
        }
      }
    `,
    { projectName: readLinearProjectName() },
  );

  const project = data.projects?.nodes?.[0];
  if (!project?.id || !project.name || !project.updatedAt) {
    return null;
  }

  return {
    id: project.id,
    name: project.name,
    url: project.url ?? null,
    status: project.status?.name?.trim() || null,
    targetDate: project.targetDate ?? null,
    priority: normalizePriority(project.priority),
    updatedAt: project.updatedAt,
  };
}

async function getProjectFromStateField(): Promise<{
  id: string;
  name: string;
  url: string | null;
  status: string | null;
  targetDate: string | null;
  priority: string | null;
  updatedAt: string;
} | null> {
  const data = await linearGraphQL<ProjectByStateFieldResponse>(
    `
      query DashboardProjectByState($projectName: String!) {
        projects(filter: { name: { eq: $projectName } }, first: 1) {
          nodes {
            id
            name
            url
            targetDate
            updatedAt
            priority
            state
          }
        }
      }
    `,
    { projectName: readLinearProjectName() },
  );

  const project = data.projects?.nodes?.[0];
  if (!project?.id || !project.name || !project.updatedAt) {
    return null;
  }

  return {
    id: project.id,
    name: project.name,
    url: project.url ?? null,
    status: project.state?.trim() || null,
    targetDate: project.targetDate ?? null,
    priority: normalizePriority(project.priority),
    updatedAt: project.updatedAt,
  };
}

async function getProjectBaseSnapshot() {
  try {
    return await getProjectFromStatusField();
  } catch {
    return getProjectFromStateField();
  }
}

async function getMilestones(projectId: string): Promise<LinearMilestoneSnapshot[]> {
  try {
    const data = await linearGraphQL<ProjectMilestonesRootResponse>(
      `
        query DashboardProjectMilestones($projectId: String!, $limit: Int!) {
          projectMilestones(
            filter: { project: { id: { eq: $projectId } } }
            first: $limit
          ) {
            nodes {
              id
              name
              targetDate
              progress
            }
          }
        }
      `,
      { projectId, limit: MAX_MILESTONES },
    );

    return normalizeMilestones(data.projectMilestones?.nodes);
  } catch {
    const data = await linearGraphQL<ProjectMilestonesNestedResponse>(
      `
        query DashboardProjectMilestonesFallback($projectId: String!, $limit: Int!) {
          projects(filter: { id: { eq: $projectId } }, first: 1) {
            nodes {
              milestones(first: $limit) {
                nodes {
                  id
                  name
                  targetDate
                  progress
                }
              }
            }
          }
        }
      `,
      { projectId, limit: MAX_MILESTONES },
    );

    return normalizeMilestones(data.projects?.nodes?.[0]?.milestones?.nodes);
  }
}

async function getIssueStatusCounts(projectId: string): Promise<LinearIssueStatusCount[]> {
  const data = await linearGraphQL<ProjectIssuesResponse>(
    `
      query DashboardProjectIssueStates($projectId: String!, $limit: Int!) {
        issues(filter: { project: { id: { eq: $projectId } } }, first: $limit) {
          nodes {
            state {
              name
            }
          }
        }
      }
    `,
    { projectId, limit: MAX_ISSUES },
  );

  const counts = (data.issues?.nodes ?? []).reduce<Record<string, number>>(
    (allCounts, issue) => {
      const state = issue.state?.name?.trim() || "Unknown";
      allCounts[state] = (allCounts[state] ?? 0) + 1;
      return allCounts;
    },
    {},
  );

  return Object.entries(counts)
    .map(([state, count]) => ({ state, count }))
    .sort((left, right) => right.count - left.count || left.state.localeCompare(right.state));
}

export async function getLinearProjectSnapshot(): Promise<LinearProjectSnapshot | null> {
  const project = await getProjectBaseSnapshot();
  if (!project) {
    return null;
  }

  const [milestonesResult, issueStatusCountsResult] = await Promise.allSettled([
    getMilestones(project.id),
    getIssueStatusCounts(project.id),
  ]);

  return {
    ...project,
    milestones:
      milestonesResult.status === "fulfilled" ? milestonesResult.value : [],
    issueStatusCounts:
      issueStatusCountsResult.status === "fulfilled"
        ? issueStatusCountsResult.value
        : [],
  };
}
