# Agent Task Control API

> **Version:** 1.0.0  
> **Base URL:** `https://[your-domain]/api/agent`  
> **Agent Name:** `ega-house`

## 1. Overview

The Agent Task Control API allows AI agents, automation scripts, and external
integrations to programmatically manage tasks, goals, and projects in the EGA
House platform. It is designed for **read-write agent access** — creating tasks,
updating their state, archiving them, and querying project/goal hierarchies.

### Key Security Concepts

- **Bearer authentication** — every request requires an `Authorization: Bearer`
  header with a scoped agent token.
- **Scope-based authorization** — each token has a strict set of permitted
  operations (e.g., `tasks:create`, `tasks:read`). Unauthorized operations
  return `403 FORBIDDEN`.
- **Owner isolation** — tokens are bound to a single user. All operations are
  scoped to that user's data.
- **No expiration by default** — tokens live until explicitly revoked. Treat
  them as long-lived credentials.
- **No human confirmation** — agent actions execute immediately without
  secondary approval. Audit trails are minimal (event logs only).

---

## 2. Setup

### 2.1 Environment Variables

The agent token system requires two environment variables:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string for token persistence |
| `AGENT_TOKEN_PEPPER` | Secret HMAC key for token hashing (must be non-empty) |

### 2.2 Generating a Token

Use the built-in CLI script to generate a new agent token:

```bash
npx tsx scripts/generate-agent-token.ts \
  --owner "00000000-0000-0000-0000-000000000001" \
  --name "my-integration" \
  --scopes '{
    "tasks": { "read": true, "create": true, "updateAny": true, "archive": true },
    "projects": { "read": true },
    "goals": { "read": true }
  }'
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `--owner` | UUID of the platform user who will own this token |
| `--name`  | Human-readable label (max 256 characters) |
| `--scopes`| JSON object defining permitted operations (see §2.3) |

**Output:** The raw token is printed to stdout **exactly once** and cannot be
retrieved again. Store it securely.

**Exit codes:** `0` on success, `1` on failure (errors go to stderr).

### 2.3 Available Scopes

```json
{
  "tasks": {
    "read":        true,
    "create":      true,
    "updateAny":   true,
    "archive":     true,
    "bulk":        true,
    "bulkLimit":   25,
    "idempotency": "source+sourceId"
  },
  "projects": { "read": true },
  "goals":    { "read": true }
}
```

| Scope | Description |
|-------|-------------|
| `tasks.read` | List and filter tasks |
| `tasks.create` | Create new tasks |
| `tasks.updateAny` | Update any task (by ID or source+sourceId) |
| `tasks.archive` | Archive / unarchive tasks |
| `tasks.bulk` | Permit bulk operations (optional, for visibility) |
| `tasks.bulkLimit` | Per-request bulk cap (integer 1–50, default 50) |
| `tasks.idempotency` | Must be `"source+sourceId"` to enable idempotent creates |
| `projects.read` | List projects |
| `goals.read` | List goals |

Scope validation is **deny-by-default** — only capabilities explicitly set to
`true` are granted.

### 2.4 Token Format

```
ega_live_<16-hex-prefix>_<48-hex-secret>
```

- **Application prefix:** `ega`
- **Purpose prefix:** `live`
- **Hex prefix (16 chars):** Used for database lookup (not secret)
- **Hex secret (48 chars):** Used for HMAC verification

### 2.5 Authentication

All requests use the `Authorization` header with a `Bearer` scheme:

```
Authorization: Bearer ega_live_a1b2c3d4e5f6a7b8_<48-hex-secret>
```

For readability, the examples in this document use two shell variables:

```bash
export EGA_AGENT_BASE_URL="https://your-domain.com/api/agent"
export EGA_AGENT_TOKEN="ega_live_<prefix>_<secret>"
```

---

## 3. Endpoints

### 3.1 GET /api/agent/capabilities

Returns the agent name and the capabilities granted by the current token.

- **Method:** `GET`
- **Path:** `/api/agent/capabilities`
- **Scope:** None required (authentication only)
- **Rate limited:** No

#### Request

```bash
curl -X GET "$EGA_AGENT_BASE_URL/capabilities" \
  -H "Authorization: Bearer $EGA_AGENT_TOKEN"
```

#### Response (200 OK)

```json
{
  "ok": true,
  "agent": "ega-house",
  "capabilities": {
    "tasks": {
      "read": true,
      "create": true,
      "updateAny": false,
      "archive": false,
      "bulk": true,
      "bulkLimit": 25,
      "idempotency": "source+sourceId"
    },
    "projects": { "read": true },
    "goals": { "read": true }
  }
}
```

The `bulkLimit` and `idempotency` fields are only present when configured on
the token.

#### Response (401 Unauthorized)

```json
{
  "ok": false,
  "error": {
    "code": "UNAUTHENTICATED",
    "message": "Missing or invalid agent token."
  }
}
```

---

### 3.2 GET /api/agent/projects

Returns the user's projects with minimized fields.

- **Method:** `GET`
- **Path:** `/api/agent/projects`
- **Scope:** `projects.read`
- **Rate limited:** Yes

#### Request

```bash
curl -X GET "$EGA_AGENT_BASE_URL/projects" \
  -H "Authorization: Bearer $EGA_AGENT_TOKEN"
```

#### Response (200 OK)

```json
{
  "ok": true,
  "projects": [
    {
      "id": "proj_abc123",
      "name": "Website Redesign",
      "slug": "website-redesign",
      "description": "Q3 product refresh",
      "status": "active",
      "createdAt": "2025-01-15T10:00:00.000Z",
      "updatedAt": "2025-06-01T14:30:00.000Z"
    }
  ]
}
```

---

### 3.3 GET /api/agent/goals

Returns the user's goals, optionally filtered by project.

- **Method:** `GET`
- **Path:** `/api/agent/goals`
- **Scope:** `goals.read`
- **Rate limited:** Yes
- **Query parameters:**
  | Parameter  | Type   | Required | Description |
  |-----------|--------|----------|-------------|
  | `projectId` | string | No       | Filter by project ID |

#### Request

```bash
curl -X GET "$EGA_AGENT_BASE_URL/goals?projectId=proj_abc123" \
  -H "Authorization: Bearer $EGA_AGENT_TOKEN"
```

#### Response (200 OK)

```json
{
  "ok": true,
  "goals": [
    {
      "id": "goal_def456",
      "projectId": "proj_abc123",
      "title": "Launch new homepage",
      "slug": "launch-new-homepage",
      "description": "Migrate from old layout",
      "nextStep": "Finalize hero section",
      "health": "on_track",
      "status": "active",
      "createdAt": "2025-02-01T09:00:00.000Z",
      "updatedAt": "2025-05-20T11:00:00.000Z"
    }
  ]
}
```

---

### 3.4 GET /api/agent/tasks

Returns the user's tasks with optional filtering.

- **Method:** `GET`
- **Path:** `/api/agent/tasks`
- **Scope:** `tasks.read`
- **Rate limited:** Yes
- **Query parameters:**
  | Parameter         | Type    | Required | Description |
  |------------------|---------|----------|-------------|
  | `projectId`       | string  | No       | Filter by project ID |
  | `goalId`          | string  | No       | Filter by goal ID |
  | `status`          | string  | No       | Filter by status (e.g. `todo`, `in_progress`, `done`) |
  | `priority`        | string  | No       | Filter by priority (e.g. `critical`, `high`, `medium`, `low`) |
  | `limit`           | integer | No       | Max results (1–200) |
  | `includeArchived` | boolean | No       | Set to `true` to include archived tasks (default: `false`) |

#### Request

```bash
curl -X GET "$EGA_AGENT_BASE_URL/tasks?projectId=proj_abc123&status=todo&limit=10" \
  -H "Authorization: Bearer $EGA_AGENT_TOKEN"
```

#### Response (200 OK)

```json
{
  "ok": true,
  "tasks": [
    {
      "id": "task_ghi789",
      "projectId": "proj_abc123",
      "goalId": "goal_def456",
      "title": "Design hero section mockup",
      "description": "Create Figma mockup for the hero section",
      "blockedReason": null,
      "status": "todo",
      "priority": "high",
      "estimateMinutes": 120,
      "focusRank": 1,
      "dueDate": "2025-06-15",
      "plannedForDate": null,
      "scheduledStartAt": null,
      "scheduledEndAt": null,
      "completedAt": null,
      "archivedAt": null,
      "createdAt": "2025-03-01T08:00:00.000Z",
      "updatedAt": "2025-05-25T16:00:00.000Z",
      "projectName": "Website Redesign",
      "goalTitle": "Launch new homepage"
    }
  ]
}
```

---

### 3.5 POST /api/agent/tasks

Creates one or more tasks in a single request. Supports idempotent creation
via `source` + `sourceId`.

- **Method:** `POST`
- **Path:** `/api/agent/tasks`
- **Scope:** `tasks.create`
- **Rate limited:** Yes
- **Bulk cap:** Max 50 tasks per request (or `bulkLimit` scope value, whichever
  is lower)

#### Request

```bash
curl -X POST "$EGA_AGENT_BASE_URL/tasks" \
  -H "Authorization: Bearer $EGA_AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tasks": [
      {
        "title": "Design hero section",
        "projectId": "proj_abc123",
        "goalId": "goal_def456",
        "description": "Create Figma mockup",
        "status": "todo",
        "priority": "high",
        "estimateMinutes": 120,
        "focusRank": 1,
        "dueDate": "2025-06-15",
        "plannedForDate": "2025-06-10",
        "scheduledStartAt": "2025-06-10T09:00:00.000Z",
        "scheduledEndAt": "2025-06-10T17:00:00.000Z",
        "blockedReason": null,
        "source": "github-issues",
        "sourceId": "repo/123"
      }
    ]
  }'
```

#### Fields Reference

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `title` | string | **Yes** | — | Task title |
| `projectId` | string | **Yes** | — | Owning project ID |
| `goalId` | string | No | `null` | Associated goal ID |
| `description` | string | No | `null` | Task description |
| `status` | string | No | `"todo"` | One of: `todo`, `in_progress`, `done`, `blocked`, `backlog`, `cancelled` |
| `priority` | string | No | `"medium"` | One of: `critical`, `high`, `medium`, `low` |
| `estimateMinutes` | number | No | `null` | Estimated effort in minutes |
| `focusRank` | number | No | `null` | Priority ordering (lower = higher) |
| `dueDate` | string (ISO date) | No | `null` | Due date |
| `plannedForDate` | string (ISO date) | No | `null` | Planning date |
| `scheduledStartAt` | string (ISO datetime) | No | `null` | Scheduled start |
| `scheduledEndAt` | string (ISO datetime) | No | `null` | Scheduled end |
| `blockedReason` | string | No | `null` | Required when `status` is `"blocked"` |
| `source` | string | No | — | External source name (for idempotency) |
| `sourceId` | string | No | — | External source ID (for idempotency) |

**Note:** Field names accept both `camelCase` and `snake_case` (e.g.
`estimateMinutes` or `estimate_minutes`, `goalId` or `goal_id`).

#### Response (200 OK — Full success)

```json
{
  "ok": true,
  "created": [
    {
      "id": "task_ghi789",
      "projectId": "proj_abc123",
      "goalId": "goal_def456",
      "title": "Design hero section",
      "description": "Create Figma mockup",
      "blockedReason": null,
      "status": "todo",
      "priority": "high",
      "estimateMinutes": 120,
      "focusRank": 1,
      "dueDate": "2025-06-15",
      "plannedForDate": null,
      "scheduledStartAt": null,
      "scheduledEndAt": null,
      "completedAt": null,
      "archivedAt": null,
      "createdAt": "2025-06-08T12:00:00.000Z",
      "updatedAt": "2025-06-08T12:00:00.000Z",
      "projectName": "Website Redesign",
      "goalTitle": "Launch new homepage"
    }
  ],
  "existing": [],
  "errors": []
}
```

#### Response (200 OK — Partial success / idempotency)

```json
{
  "ok": true,
  "created": [
    { /* ... newly created task ... */ }
  ],
  "existing": [
    { /* ... previously created task returned via idempotency ... */ }
  ],
  "errors": [
    { "index": 2, "error": "Title is required." },
    { "index": 3, "error": "Blocked reason is required when status is blocked." }
  ]
}
```

---

### 3.6 PATCH /api/agent/tasks

Updates one or more existing tasks. Tasks can be targeted by `taskId` or by
`source` + `sourceId`. Only allowlisted fields can be modified.

- **Method:** `PATCH`
- **Path:** `/api/agent/tasks`
- **Scope:** `tasks.updateAny`
- **Rate limited:** Yes
- **Bulk cap:** Max 50 tasks per request (or `bulkLimit`)

#### Request

```bash
curl -X PATCH "$EGA_AGENT_BASE_URL/tasks" \
  -H "Authorization: Bearer $EGA_AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tasks": [
      {
        "taskId": "task_ghi789",
        "status": "done",
        "priority": "critical"
      },
      {
        "source": "github-issues",
        "sourceId": "repo/456",
        "title": "Updated title",
        "description": null
      }
    ]
  }'
```

#### Allowed Update Fields

| Field | Type | Effect |
|-------|------|--------|
| `title` | string | Change title |
| `description` | string \| `null` | Change / clear description |
| `goalId` | string \| `null` | Reassign to different goal |
| `status` | string | Change status |
| `priority` | string | Change priority |
| `dueDate` | string \| `null` | Change / clear due date |
| `estimateMinutes` | number \| `null` | Change / clear estimate |
| `scheduledStartAt` | string \| `null` | Change / clear scheduled start |
| `scheduledEndAt` | string \| `null` | Change / clear scheduled end |
| `blockedReason` | string \| `null` | Change / clear blocked reason |

**Protected fields** (cannot be updated via this API):
`projectId`, `focusRank`, `plannedForDate`, `archived` (use the archive
endpoint instead), `id`, `createdAt`, `updatedAt`, `completedAt`, `archivedAt`.

Target identification fields (`taskId`, `source`, `sourceId`) are consumed
for routing and are not applied as updates to the task.

#### Response (200 OK)

```json
{
  "ok": true,
  "updated": [
    {
      "id": "task_ghi789",
      "projectId": "proj_abc123",
      "goalId": "goal_def456",
      "title": "Design hero section",
      "description": "Create Figma mockup",
      "blockedReason": null,
      "status": "done",
      "priority": "critical",
      "estimateMinutes": 120,
      "focusRank": 1,
      "dueDate": "2025-06-15",
      "plannedForDate": null,
      "scheduledStartAt": null,
      "scheduledEndAt": null,
      "completedAt": "2025-06-08T12:05:00.000Z",
      "archivedAt": null,
      "createdAt": "2025-03-01T08:00:00.000Z",
      "updatedAt": "2025-06-08T12:05:00.000Z",
      "projectName": "Website Redesign",
      "goalTitle": "Launch new homepage"
    }
  ],
  "errors": []
}
```

When `status` is changed to `"done"`, the server automatically sets
`completedAt` to the current timestamp.

---

### 3.7 POST /api/agent/tasks/archive

Archives or unarchives one or more tasks without changing their status or other
fields. Archive is a separate lifecycle dimension from task status.

- **Method:** `POST`
- **Path:** `/api/agent/tasks/archive`
- **Scope:** `tasks.archive`
- **Rate limited:** Yes
- **Bulk cap:** Max 50 tasks per request (or `bulkLimit`)

#### Request (Archive)

```bash
curl -X POST "$EGA_AGENT_BASE_URL/tasks/archive" \
  -H "Authorization: Bearer $EGA_AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tasks": [
      {
        "taskId": "task_ghi789",
        "archived": true
      },
      {
        "source": "github-issues",
        "sourceId": "repo/456",
        "archived": true
      }
    ]
  }'
```

#### Request (Unarchive)

```bash
curl -X POST "$EGA_AGENT_BASE_URL/tasks/archive" \
  -H "Authorization: Bearer $EGA_AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tasks": [
      {
        "taskId": "task_ghi789",
        "archived": false
      }
    ]
  }'
```

#### Response (200 OK)

```json
{
  "ok": true,
  "archived": [
    {
      "id": "task_ghi789",
      "projectId": "proj_abc123",
      "goalId": "goal_def456",
      "title": "Design hero section",
      "description": "Create Figma mockup",
      "blockedReason": null,
      "status": "done",
      "priority": "high",
      "estimateMinutes": 120,
      "focusRank": 1,
      "dueDate": "2025-06-15",
      "plannedForDate": null,
      "scheduledStartAt": null,
      "scheduledEndAt": null,
      "completedAt": "2025-06-08T12:05:00.000Z",
      "archivedAt": "2025-06-08T13:00:00.000Z",
      "createdAt": "2025-03-01T08:00:00.000Z",
      "updatedAt": "2025-06-08T13:00:00.000Z",
      "projectName": "Website Redesign",
      "goalTitle": "Launch new homepage"
    }
  ],
  "unarchived": [],
  "errors": []
}
```

---

## 4. Idempotency

Task creation can be made idempotent by supplying both `source` and `sourceId`
fields in the task payload.

### How It Works

1. When a task is created with `source` + `sourceId`, the platform stores a
   reference record (`task_external_refs`) mapping
   `(owner, source, sourceId)` → `taskId`.
2. On subsequent create requests for the same `source` + `sourceId`, the
   platform detects the existing reference and returns the previously created
   task in the `existing` array instead of creating a duplicate.
3. The response body distinguishes newly created tasks (`created`) from
   pre-existing ones (`existing`).

### Requirements

- The token must have `"idempotency": "source+sourceId"` in its scopes
  (without this, `source`/`sourceId` are ignored).
- Both `source` and `sourceId` must be provided on every request for
  idempotency to take effect.
- The `source` value names the external system (e.g. `"github-issues"`,
  `"jira"`). The `sourceId` uniquely identifies the item within that system.

### Retry Safety

Because the server deduplicates on `(source, sourceId)`, you can safely retry
a create after a network error without risking duplicate tasks — the second
attempt returns the existing task.

---

## 5. Bulk Operations

All write endpoints (`POST /api/agent/tasks`, `PATCH /api/agent/tasks`,
`POST /api/agent/tasks/archive`) accept a `tasks` array in the request body.

### Limits

| Constraint | Value |
|-----------|-------|
| Hard cap | 50 items per request |
| Scope cap | `bulkLimit` on the token, if lower than 50 |
| Enforcement | Rejected with `400 INVALID_REQUEST` if exceeded |

### Partial Success

Bulk operations use **per-item processing**. An error on one item does not
prevent others from succeeding. The response always includes:

- Arrays of successfully processed items (`created`, `updated`, `archived`,
  `unarchived`)
- An `errors` array with `{ index, error }` objects describing failed items

This means a successful HTTP status (`200`) can coexist with individual item
failures. Check the `errors` array to detect partial failures.

---

## 6. Rate Limiting

The API uses a sliding-window rate limiter keyed by the agent token ID.

| Property | Value |
|----------|-------|
| Window | 60 seconds |
| Maximum requests | 60 per window (per token) |
| Implementation | In-memory (single-process) |

### Rate Limited Response (429)

```json
{
  "ok": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Rate limit exceeded. Retry after 42 seconds."
  },
  "retryAfter": 42
}
```

The response includes the `Retry-After` header with the number of seconds to
wait. The `retryAfter` field in the body provides the same value.

### Handling

```bash
# Example: wait and retry
sleep $(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $EGA_AGENT_TOKEN" \
  "$EGA_AGENT_BASE_URL/tasks" \
  | grep 429 && echo 5 || echo 0)
```

---

## 7. Error Codes

All errors return the same envelope:

```json
{
  "ok": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description."
  }
}
```

| Code | HTTP Status | Meaning |
|------|-------------|---------|
| `UNAUTHENTICATED` | 401 | Missing, malformed, or invalid `Authorization` header. Token not found, revoked, or HMAC verification failed. The error message is deliberately generic to avoid leaking information. |
| `FORBIDDEN` | 403 | Token is valid but lacks the required scope for this operation (e.g. trying to create tasks without `tasks:create`). |
| `INVALID_REQUEST` | 400 | Request body is not valid JSON, missing required envelope fields, exceeds bulk limits, or has malformed field types. |
| `VALIDATION_ERROR` | 422 | Request body is structurally valid but fails business rules (e.g. title empty after trimming, `status: "blocked"` without `blockedReason`). |
| `CONFLICT` | 409 | The request conflicts with the current state (reserved for future use — e.g. concurrent modification). |
| `UNPROCESSABLE` | 422 | The request was understood but cannot be processed (reserved for future use). |
| `RATE_LIMITED` | 429 | Rate limit exceeded. Check the `Retry-After` header and `retryAfter` body field. |
| `INTERNAL_ERROR` | 500 | Unexpected server error. The request could not be completed. Retry with backoff. |

### Common Error Troubleshooting

| Symptom | Likely Cause | Check |
|---------|--------------|-------|
| `401 UNAUTHENTICATED` | Token invalid or revoked | Verify the full token string. Was `AGENT_TOKEN_PEPPER` changed after token creation? |
| `403 FORBIDDEN` | Missing scope | Call `/api/agent/capabilities` to confirm granted scopes. |
| `400 INVALID_REQUEST` — "Request must include a 'tasks' array" | Wrong envelope shape | Ensure body is `{ "tasks": [...] }`, not a bare array. |
| `400 INVALID_REQUEST` — "Maximum of N tasks allowed" | Bulk limit exceeded | Reduce the number of items or request a higher `bulkLimit` on the token. |
| Unexpected `500` | Pepper not configured | Verify `AGENT_TOKEN_PEPPER` is set and non-empty. |

---

## 8. Field Allowlists

### Update (PATCH) Allowlist

Only these fields can be modified via `PATCH /api/agent/tasks`:

`title`, `description`, `goalId`, `status`, `priority`, `dueDate`,
`estimateMinutes`, `scheduledStartAt`, `scheduledEndAt`, `blockedReason`

Any other field in the update payload is treated as unknown or protected and
causes that item to fail with an error.

### Create (POST) Allowlist

The create endpoint accepts all documented fields in §3.5. Fields not in that
list are silently ignored.

### Protected Fields (never writable via agent API)

`id`, `projectId`, `focusRank`, `plannedForDate`, `createdAt`, `updatedAt`,
`completedAt`, `archivedAt`, `archived` (use the archive endpoint),
`ownerUserId` (implicit), `tokenId` (implicit).

---

## 9. Archive Semantics

Archiving is a **separate lifecycle dimension** from task status.

- A task can be `todo` and archived, or `done` and not archived, or any
  combination.
- Archiving sets the `archivedAt` timestamp but leaves `status`, `priority`,
  and all other fields unchanged.
- Unarchiving clears `archivedAt` (sets it to `null`).
- By default, `GET /api/agent/tasks` **excludes archived tasks**. Pass
  `includeArchived=true` to include them.
- Archive/unarchive is not a status transition — it does not affect
  `completedAt`, `blockedReason`, or any other status-related field.

### Use Cases

- **Soft-delete:** Archive tasks that are no longer relevant without deleting
  them.
- **Cleanup:** Archive completed tasks from a sprint while keeping them for
  historical reporting.
- **Restore:** Unarchive a task that becomes relevant again.

---

## 10. Troubleshooting

### "Missing or invalid agent token" (401)

1. Check that the `Authorization` header is present and formatted correctly:
   `Bearer ega_live_<prefix>_<secret>`.
2. Verify the token hasn't been revoked.
3. Check that `AGENT_TOKEN_PEPPER` hasn't changed since the token was created
   (changing the pepper invalidates all existing tokens).
4. Confirm `DATABASE_URL` points to the correct database.

### "Agent token lacks X scope" (403)

1. Call `GET /api/agent/capabilities` with the same token to see your granted
   scopes.
2. Create a new token with the required scopes if necessary.

### "Title is required" or "Project ID is required" (in errors array)

These fields are mandatory for task creation. Ensure every task object in the
`tasks` array has a non-empty `title` and a valid `projectId`.

### "Blocked reason is required when status is blocked" (in errors array)

When setting `status: "blocked"`, you must also provide a `blockedReason`
string explaining why.

### "Failed to create task" (in errors array)

A database-level error occurred during insert. This can happen if the project
or goal referenced by `projectId` / `goalId` does not exist or is not owned by
the token's user.

### "Task not found" (in errors array for PATCH / archive)

The `taskId` does not exist, has been deleted, or belongs to a different user.
Alternatively, if using `source` + `sourceId`, no matching external reference
exists.

### Rate limit violations (429)

Space out your requests. The rate limit resets after 60 seconds. Use the
`Retry-After` header to determine how long to wait.

---

## 11. Security Warnings

### ⚠️ No Expiration by Default

Agent tokens do not expire. They remain valid until explicitly revoked. If a
token is leaked, it can be used indefinitely. **Rotate tokens regularly** and
revoke unused ones.

### ⚠️ Tokens Are Powerful

A token with `tasks:create`, `tasks:updateAny`, and `tasks:archive` scopes
has full read/write access to every task owned by the user. Grant only the
minimum scopes needed.

### ⚠️ No Human Confirmation

Agent API calls execute immediately. There is no "are you sure?" prompt, no
secondary approval flow, and no undo button. Test your integration with a
limited scope token on non-production data first.

### ⚠️ Audit Is Minimal

The only audit trail is event records in the `agent_integration_events` table
(e.g., `task.created`, `task.updated`). These records include the token ID
and resource ID but are not human-readable logs. Monitor usage through your
own logging on the client side.
