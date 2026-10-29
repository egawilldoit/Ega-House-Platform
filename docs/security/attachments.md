# Task attachments and project Files (EGA-802)

Owner-scoped files for tasks, with a project Files view. Implemented on the
private Supabase Storage bucket `task-attachments`, with metadata in
`public.task_attachments` (migration
[`0074_task_attachments.sql`](../../drizzle/0074_task_attachments.sql)).

## What is authoritative

| Concern | Owner |
| --- | --- |
| Limits, file-name/type/content rules | `@ega/domain` (`attachments.ts`) |
| Wire shapes | `@ega/contracts` (`attachments.ts`) |
| Pending/finalized workflow, signed URLs, cleanup | `apps/web/src/lib/services/attachment-service.ts` |
| Metadata RLS, write functions, activity emission | migration `0074_task_attachments.sql` |
| Bucket privacy, path policy, bucket size/MIME limits | migration `0074_task_attachments.sql` |
| Files tab read model | `apps/web/src/app/tasks/projects/[slug]/_components/project-files-panel.tsx` |

The database and the service both enforce limits. The service checks the file
before issuing an upload ticket; the ticket function re-checks size, MIME,
task ownership, the per-task ceiling and the owner quota; finalization re-reads
the stored object and verifies its measured size and content signature.

## Limits

- 10 MiB per file (enforced by the service, the ticket function, the metadata
  check constraint and the bucket `file_size_limit`).
- 20 files per task.
- 200 MiB per owner.
- Allowed types: PNG, JPEG, GIF, WebP, PDF, plain text/log, Markdown, CSV.
  SVG, HTML, JavaScript and other active content are rejected. The extension and
  the client MIME are hints; finalization sniffs the stored bytes.

This is **content validation, not malware scanning**. No antivirus scanner is
configured in this repository, and no code claims a file was scanned or safe.

## Workflow

1. `createAttachmentUpload` validates the candidate, then calls
   `create_task_attachment_upload`. The function derives the owner from
   `auth.uid()`, proves the task belongs to that owner, checks limits and
   inserts a `pending` row. The object path is built by the database:
   `<owner_user_id>/<task_id>/<attachment_id>.<extension>`.
2. The server mints a signed upload URL for that path. The browser PUTs the
   bytes and reports real `XMLHttpRequest` progress.
3. `finalizeAttachment` lists the object, checks the stored size, downloads and
   sniffs the bytes, then calls `finalize_task_attachment`. A rejected file is
   removed and marked `failed`.
4. Delete removes the object first and the metadata row second. Both steps are
   idempotent, so either half can be retried. A failed object delete keeps the
   row addressable.

A retry reuses the client-generated idempotency key, so the same upload resolves
to the same row instead of creating a duplicate.

Abandoned pending tickets expire after **120 minutes** (the lifetime of a signed
upload URL). `createAttachmentUpload` performs one bounded cleanup pass (five
rows) that removes expired objects and metadata. A signed URL already handed out
cannot be revoked early.

## Authorization and URL lifetime

- `task_attachments` has an owner + parent-task `SELECT` policy. There is no
  `INSERT`/`UPDATE`/`DELETE` grant or policy for `authenticated`; the
  `SECURITY DEFINER` functions are the only writer, so a client cannot insert a
  `finalized` row and skip content validation.
- Storage policies restrict every operation to objects whose first path segment
  is `auth.uid()`. A path prefix alone is not parent proof, so the ticket and
  finalize functions also check task ownership.
- Preview/download URLs are minted only after an owner-scoped lookup of a
  finalized row. They live for **60 seconds**. They are never persisted or
  logged, and they are not treated as instantly revocable authorization: an
  already-issued URL stays valid until it expires.
- The bucket is private (`public = false`).

## Activity

Finalizing a pending row and deleting a finalized row write
`attachment_added` / `attachment_removed` rows to the EGA-784
`task_activity_events` ledger through a `SECURITY DEFINER` trigger. Pending or
failed uploads are not activity.

## Verification

- `apps/web/src/lib/services/attachment-service.test.ts` — limits, forged parent
  ids, idempotent finalize/delete, content rejection, signed URL issuance.
- `packages/domain/test/attachments.test.ts` — candidate/content/limit rules.
- `scripts/db/task-attachments-rls-verify.mjs` (CI `db-invariants`) — applies the
  journal to a disposable Postgres and proves two-owner metadata and storage
  denial, direct-write denial, server-built paths, limits, idempotency and
  activity emission.
- Component tests cover empty/loading/error, upload rejection, preview, delete
  and unfinished-upload states.
