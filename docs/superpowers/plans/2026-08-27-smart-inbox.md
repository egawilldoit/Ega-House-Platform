# Smart Inbox Plan — 2026-08-27

Branch: feat/smart-inbox
Worktree: .worktrees/smart-inbox
Base: 1a01bf3d03bf2394358f204448d247f1b04d544e

## Parent EGA-493
Promote idea_notes into shared product core; capture; conversion; AI proposals; processing loop.

One writer per worktree, sequential waves I1->I2->I3, I4 blocked on HITL provider, I5 needs Operator.

## I1 EGA-505 Promote idea_notes
Current: src/db/schema.ts idea_notes exists; apps/web idea-note-service.ts web-only; no shared app/contracts/api.
Tasks:
- Application: packages/application/src/inbox/ — use cases: createIdeaNote, listIdeaNotes, updateIdeaNote, archive, convert link. Port InboxRepository.
- Domain: packages/domain/src/inbox-status.ts — statuses inbox/reviewing/planned/archived/converted
- Data-access: packages/data-access/src/repositories/inbox-repository.ts owner-scoped
- Contracts: packages/contracts/src/inbox.ts DTOs + zod schemas
- Server: apps/server/src/routes/inbox.ts Hono CRUD +idempotency key header
- Api-client: packages/api-client/src/inbox.ts
- Mobile: apps/mobile app/(tabs)/inbox.tsx minimal screen consuming api-client
- Web: keep apps/web/src/app/ideas/page.tsx working via canonical use case adapter
Validation: application:test, data-access:test, contracts:typecheck, server:test, api-client:typecheck

## I2 EGA-506 Fast capture
Capture = unstructured global capture, QuickTaskSheet remains structured.
Tasks:
- Web: global capture affordance (header/sheet) routing to Inbox create without Project required; preserve QuickTaskSheet
- Mobile: FAB capture input preserving draft on failure, retry idempotency via client-generated request id
- Server idempotency: handle X-Idempotency-Key dedupe via idea_notes external ref or new inbox_idempotency table
- Tests: capture without project, draft retained on network failure, retry doesn't duplicate, no false success
Commit: feat: add fast Inbox capture with retry safety (EGA-506)

## I3 EGA-507 Safe conversion
Allowed: Task + existing Project/Goal + reminder + archive. No auto Project/Goal creation.
Tasks:
- Audit task_external_refs table: if exists and owner-scoped, reuse for Inbox->Task idempotency, else add inbox_task_links
- Use case convertInboxItemToTask: validate existing Project/Goal ownership, reuse Task create use case, persist link before marking converted, recoverable on partial failure
- Tests: same approved conversion no second Task, failed link still recoverable, archive/keep, cross-owner blocked, manual fallback
Commit: feat: add safe Inbox conversion with idempotency (EGA-507)

## I4 EGA-508 HITL — BLOCKED until provider approved
Implement provider-neutral interface only: schemas, generation metadata, prompt version, bounded input, allow-list validation, timeout/rate, fallback. No concrete provider wiring until human approves.
Tasks: application/src/inbox/ai-classification-port.ts + validation + telemetry without secrets

## I5 EGA-509 — BLOCKED on Operator (EGA-516)
Processing loop + count signal to Operator. Build independent processing UI now, Operator handoff deferred.

Ledger: I1->I2->I3 sequential; I4/I5 deferred with BLOCKED comments.
