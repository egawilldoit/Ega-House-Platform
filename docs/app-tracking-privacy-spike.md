# App/Domain Tracking Privacy Model — Spike

## Context

The EGA House PRD references "per web" analytics as a Potential Phase 5 feature. This spike clarifies what "per web" means, evaluates whether true website/app/domain tracking is feasible, and proposes a privacy-first opt-in data model if needed.

## Key Question: What Does "Per Web" Mean?

"Per web" in the PRD is ambiguous. It could mean:

| Interpretation | Description | Verdict |
|---|---|---|
| **Weekly analytics** | Summary of weekly tracked time, active days, session count, top projects. Already mostly implemented in Work Analytics. | **Not what this issue means.** This is the Work Analytics Command Center itself. |
| **True website/app/domain analytics** | Breakdown of tracked time **by the domain or app** the user was working on during a timer session. E.g., "2h on github.com", "1h in VS Code". | **This is the intended interpretation.** |

**Recommendation:** Proceed with a limited opt-in activity event model for true domain/app tracking, but **only as an opt-in supplementary data source**, not a default platform feature.

---

## Proposed Activity Event Model

If true domain/app tracking is implemented, it should use the following data model:

```
activity_events
├── id: UUID (PK)
├── owner_user_id: UUID (FK → auth.users)
├── session_id: UUID (FK → task_sessions, nullable)
├── source_type: ENUM ('timer', 'browser_tab', 'desktop_app', 'manual')
├── source_name: VARCHAR(256)     // "Chrome", "VS Code", "Slack"
├── domain: VARCHAR(512)          // "github.com" (browser only), nullable
├── window_title: VARCHAR(512)    // "EGA-384 · Hermes · GitHub", nullable
├── activity_started_at: TIMESTAMPTZ
├── activity_ended_at: TIMESTAMPTZ, nullable
├── inferred_task_id: UUID (FK → tasks, nullable)
├── consent_token: VARCHAR(64)    // opaque token verifying opt-in status
├── deleted_at: TIMESTAMPTZ, nullable
├── created_at: TIMESTAMPTZ
└── updated_at: TIMESTAMPTZ
```

### Field notes

- **`source_type`**: Distinguishes manual entry (user types "I worked on X") from automatic collection (browser extension, desktop watcher).
- **`domain`**: Only collected from browser sources. Never collected from desktop apps.
- **`window_title`**: Potentially sensitive. Must be **opt-in at install time** and user must be able to see/edit/delete collected titles.
- **`inferred_task_id`**: Nullable FK to tasks table. Set by the user manually or by an opt-in suggestion system. Never set automatically without user confirmation.
- **`consent_token`**: Opaque token stored client-side verifying that the user gave active consent for activity tracking. Revoked on opt-out, which stops all collection.

---

## Privacy Mandates (Hard Rules)

These rules must be enforced in code and auditable:

### 1. Opt-In Only, No Default Collection

- Activity event collection is **opt-in at the workspace level**.
- No activity data is collected until the user explicitly enables it in settings.
- The setting must be a separate toggle from general timer/task analytics.
- Default state: **OFF**.

### 2. No Raw URLs or Window Titles by Default

- **`domain`**: Only the registered domain (e.g., `github.com`). Never full URLs (`github.com/egawilldoit/Ega-House-Platform/pull/56`).
- **`window_title`**: Only collected if the user has explicitly opted in to "Capture window titles" (separate sub-toggle). Never collected by default even when activity tracking is on.
- No keystroke tracking, no screenshot capture, no content extraction.

### 3. Pause/Disable/Delete

- **Pause**: User can temporarily pause activity collection without losing existing data. A `paused_at` field on the consent record.
- **Disable (opt-out)**: User can fully disable activity collection. The consent token is revoked; no new events are collected.
- **Delete**: User can request deletion of all their activity events. This is a hard delete (or soft delete with a short TTL) that removes both the events and any derived aggregates.
- Export should include activity events when a user requests data download.

### 4. Data Retention

- Activity events older than **90 days** are automatically deleted (hard delete) unless the user has explicitly exported or "pinned" them.
- Aggregated stats (domain-based time totals) may be kept longer (180 days) since they contain no individually identifying content.

---

## Implementation Approaches

### Option A: Browser Extension (Recommended for Phase 1)

A lightweight browser extension that sends tab-activity data via a secure API.

**Pros:**
- Clean separation from the main app backend.
- User can review/consent before installation.
- Open-source the extension for auditability.

**Cons:**
- Desktop apps not tracked.
- User must install and maintain the extension.

### Option B: Desktop Watcher (Phase 2)

A desktop tray application that reads active window titles.

**Pros:**
- Captures desktop work (VS Code, terminals, design tools).
- More complete picture of work time.

**Cons:**
- Requires native install per OS.
- Window titles are sensitive.
- User must manage another application.

### Option C: Manual Tags (Always Available)

Inline with the timer flow: during a timer session, user can tag "What are you working on?" with a free-form source name ("GitHub PR review", "Writing docs"). This is the simplest path and should be the default MVP.

**Pros:**
- Zero privacy risk.
- No extension/watcher needed.
- User-curated data is high quality.

**Cons:**
- Requires user effort.
- May miss context-switching details.

## Privacy Risks

| Risk | Mitigation |
|---|---|
| Window title may contain PII (names, emails, credit card numbers in web apps) | Never collect window titles by default. Separate opt-in toggle. |
| Domain could reveal sensitive projects | Only collected when activity tracking is on. User can pause/disable. |
| Background monitoring without user awareness | Desktop/browser watcher must show a visible indicator when active. |
| Data leaks via browser extension | Extension is open source. All data is sent over HTTPS to the user's own API. |
| Aggregated stats could be de-anonymized | Never store raw domains after 90 days. Aggregate stats are kept at project/source-type level only. |

## Non-Goals

- **Automatic activity-to-task inference**: No ML model infers which task you were working on based on activity. The `inferred_task_id` is set manually by the user or not at all.
- **Browser extension implementation**: Not in this spike. This spike defines the model for when/if it's built.
- **Desktop watcher implementation**: Out of scope for Phase 5.
- **Productivity scoring**: Activity events are for user self-review, not automated productivity assessment.
- **Collecting real browsing/app data**: This spike produces no data collection code.

## Recommendation

**Defer true website/app/domain tracking to a separate product track** with a dedicated privacy review.

In the meantime:
1. Implement **manual source tagging** in the timer flow (Option C) — this is safe, adds immediate value, and requires no privacy model.
2. Design the `activity_events` schema for when browser/desktop tracking reaches product-market fit.
3. Do **not** build the browser extension or desktop watcher until the privacy model is approved by legal/product review.
