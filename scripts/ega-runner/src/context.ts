import type postgres from "postgres";

export interface QueuePayload {
  run_id: string;
  project_id: string;
  project_slug: string;
  github_repo: string;
  base_branch: string;
  linear_issue_id: string;
  linear_issue_identifier: string;
  linear_issue_url: string;
  attempt_number: number;
  validation_commands: string[];
}

export interface IssueSpec {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  projectId: string;
  status: string;
  priority: string | null;
  assigneeId: string | null;
  parentId: string | null;
  parentIdentifier: string | null;
  labels: string[];
  readyForHermes: boolean;
  inImplementationProject: boolean;
  blockerIds: string[];
  branchName: string | null;
}

export interface ParentSpec {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  status: string;
  url: string;
}

export interface ContextResult {
  issue: IssueSpec;
  parent: ParentSpec | null;
  contextHash: string;
  authorizationCheck: AuthorizationCheck;
}

export interface AuthorizationCheck {
  ok: boolean;
  reason?: string;
}

export function computeContextHash(
  payload: QueuePayload,
  issue: IssueSpec,
  parent: ParentSpec | null,
  allowedPaths: string[],
  baseSha: string,
): string {
  const parts = [
    // Child issue (the implementation task)
    issue.id,
    issue.identifier,
    issue.title,
    issue.description ?? "",
    payload.linear_issue_url,

    // Parent spec
    parent?.id ?? "no_parent",
    parent?.identifier ?? "none",
    parent?.title ?? "none",
    parent?.description ?? "none",
    parent?.url ?? "none",

    // Allowed paths
    JSON.stringify([...allowedPaths].sort()),

    // Validation commands
    JSON.stringify([...payload.validation_commands].sort()),

    // Repository context
    payload.github_repo,
    payload.base_branch,
    baseSha,

    // Run context
    payload.run_id,
    payload.attempt_number.toString(),
    issue.status,
    issue.priority ?? "none",
    JSON.stringify([...issue.labels].sort()),
    issue.readyForHermes ? "ready" : "not_ready",
  ];
  return simpleHash(parts.join("|"));
}

function simpleHash(input: string): string {
  // FNV-1a 64-bit hex digest for deterministic non-crypto hashing
  let hash = 0xcbf29ce484222325n;
  const fnvPrime = 0x100000001b3n;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * fnvPrime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

/**
 * Fetch the Linear issue and validate authorization gates.
 *
 * Normal mode: LINEAR_API_KEY is required. Missing key fails closed.
 * Mock/test mode: allowed when NODE_ENV=test or EGA_RUNNER_ALLOW_MOCK_LINEAR=true.
 *
 * The context hash is computed separately after allowed paths and base SHA
 * are resolved — call computeContextHash() in the pipeline.
 */
export async function fetchIssueSpec(
  payload: QueuePayload,
  _db: postgres.Sql<{}>,
): Promise<ContextResult> {
  const linearToken = process.env.LINEAR_API_KEY;
  const linearApiUrl = "https://api.linear.app/graphql";

  const isTestMode = process.env.NODE_ENV === "test";
  const allowMock = process.env.EGA_RUNNER_ALLOW_MOCK_LINEAR === "true";
  const useMock = isTestMode || allowMock;

  if (!linearToken && !useMock) {
    throw new Error(
      "LINEAR_API_KEY is not set. The Runner cannot resolve the issue context " +
      "without a Linear API key. Set LINEAR_API_KEY in the environment, or " +
      "set EGA_RUNNER_ALLOW_MOCK_LINEAR=true (test/development only).",
    );
  }

  let issue: IssueSpec;
  let parent: ParentSpec | null = null;

  if (linearToken) {
    const result = await fetchIssueFromLinear(payload.linear_issue_id, linearToken, linearApiUrl);
    issue = result.issue;
    parent = result.parent;
  } else {
    issue = buildMockIssue(payload);
    parent = null;
  }

  const authCheck = checkAuthorization(issue, payload);

  return { issue, parent, contextHash: "", authorizationCheck: authCheck };
}

async function fetchIssueFromLinear(
  linearIssueId: string,
  apiKey: string,
  apiUrl: string,
): Promise<{ issue: IssueSpec; parent: ParentSpec | null }> {
  const query = `
    query Issue($id: String!) {
      issue(id: $id) {
        id
        identifier
        title
        description
        project { id }
        state { name }
        priority
        assignee { id }
        labels { nodes { name } }
        parent {
          id
          identifier
          title
          description
          state { name }
          url
        }
        children { nodes { id state { name } } }
        branchName
      }
    }
  `;

  let response: Response;
  try {
    response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ query, variables: { id: linearIssueId } }),
    });
  } catch (err) {
    throw new Error(`Linear API request failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  let body: Record<string, unknown>;
  try {
    body = await response.json();
  } catch {
    throw new Error(`Linear API returned non-JSON response (HTTP ${response.status})`);
  }

  if (body.errors && Array.isArray(body.errors) && body.errors.length > 0) {
    const errorMessages = body.errors.map((e: Record<string, unknown>) => e.message).join("; ");
    throw new Error(`Linear GraphQL errors: ${errorMessages}`);
  }

  const data = body.data as Record<string, unknown> | undefined;
  if (!data?.issue) {
    throw new Error(`Linear API returned no issue data for ${linearIssueId}`);
  }

  const issueData = data.issue as Record<string, unknown>;
  const state = issueData.state as Record<string, unknown> | undefined;
  const project = issueData.project as Record<string, unknown> | undefined;
  const labels = issueData.labels as Record<string, unknown> | undefined;
  const labelNodes = labels?.nodes as Array<Record<string, unknown>> | undefined;
  const labelNames = (labelNodes ?? []).map((l: Record<string, unknown>) => String(l.name ?? ""));
  const children = issueData.children as Record<string, unknown> | undefined;
  const childNodes = children?.nodes as Array<Record<string, unknown>> | undefined;
  const blockerIds = (childNodes ?? [])
    .filter((c: Record<string, unknown>) => {
      const childState = c.state as Record<string, unknown> | undefined;
      return childState?.name === "Todo" || childState?.name === "In Progress";
    })
    .map((c: Record<string, unknown>) => String(c.id ?? ""));

  const parentData = issueData.parent as Record<string, unknown> | null | undefined;

  if (!issueData.id || !issueData.identifier || !issueData.title) {
    throw new Error(`Linear API returned incomplete issue data for ${linearIssueId}: missing required fields`);
  }

  const issue: IssueSpec = {
    id: String(issueData.id),
    identifier: String(issueData.identifier),
    title: String(issueData.title),
    description: (issueData.description as string) ?? null,
    projectId: String((project?.id as string) ?? ""),
    status: String((state?.name as string) ?? "in_progress"),
    priority: (issueData.priority as string) ?? null,
    assigneeId: (issueData.assignee as Record<string, unknown> | null)?.id as string ?? null,
    parentId: (parentData?.id as string) ?? null,
    parentIdentifier: (parentData?.identifier as string) ?? null,
    labels: labelNames,
    readyForHermes: labelNames.includes("ready-for-hermes"),
    inImplementationProject: true,
    blockerIds,
    branchName: (issueData.branchName as string) ?? null,
  };

  let parent: ParentSpec | null = null;
  if (parentData && parentData.id) {
    if (!parentData.identifier || !parentData.title) {
      throw new Error(`Linear API returned incomplete parent data for ${linearIssueId}`);
    }
    const parentState = parentData.state as Record<string, unknown> | undefined;
    parent = {
      id: String(parentData.id),
      identifier: String(parentData.identifier),
      title: String(parentData.title),
      description: (parentData.description as string) ?? null,
      status: String((parentState?.name as string) ?? ""),
      url: String(parentData.url ?? ""),
    };
  }

  return { issue, parent };
}

function buildMockIssue(payload: QueuePayload): IssueSpec {
  return {
    id: payload.linear_issue_id,
    identifier: payload.linear_issue_identifier,
    title: `Implement ${payload.linear_issue_identifier}`,
    description: `## Scope / Expected files\n- src/components/layout/top-bar.tsx\n- src/components/layout/top-bar.test.tsx\n- src/app/globals.css`,
    projectId: payload.project_id,
    status: "in_progress",
    priority: "high",
    assigneeId: null,
    parentId: "mock-parent-001",
    parentIdentifier: "MOCK-PARENT-001",
    labels: ["ready-for-hermes"],
    readyForHermes: true,
    inImplementationProject: true,
    blockerIds: [],
    branchName: `${payload.linear_issue_identifier?.toLowerCase() ?? "issue"}-mock`,
  };
}

export function checkAuthorization(
  issue: IssueSpec,
  _payload: QueuePayload,
): AuthorizationCheck {
  if (!issue.inImplementationProject) {
    return { ok: false, reason: `Issue ${issue.identifier} not in Implementation project` };
  }

  if (!issue.readyForHermes) {
    return { ok: false, reason: `Issue ${issue.identifier} missing 'ready-for-hermes' label` };
  }

  if (issue.blockerIds.length > 0) {
    return { ok: false, reason: `Issue ${issue.identifier} has ${issue.blockerIds.length} open blocker(s)` };
  }

  return { ok: true };
}
