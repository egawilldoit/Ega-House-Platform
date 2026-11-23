# Backup dump exposure — classification and close-out

Date: 2026-11-23. Status: **data-bearing exposure confirmed; containment partially applied; credential and history decisions pending**.

## Summary

`backups/prod-pre-sprint2-full-20260504.dump` (278,567 bytes, blob `004552be…`) was tracked in this public repository from 2026-06-01 until removal from `main` on 2026-11-21 in PR #418. It is a **PostgreSQL custom-format (`PGDMP`, gzip-compressed) archive**, not plain SQL text.

The blob remains publicly downloadable from 298 of 306 remote branch tips, 9 tags, and the fork `abdelilahmortaki/Ega-House-Platform`. `main`'s tip is clean (raw path 404).

## Classification evidence

A raw-byte scan initially suggested "schema only". That was **incorrect** because the table data is compressed inside the custom-format archive. The archive was re-inspected with `pg_restore --data-only -f -`; only aggregate counts were recorded, never values.

| Check | Result |
|---|---|
| Archive format | PGDMP custom, gzip, 502 TOC entries, pg_dump 18.1 |
| Data rows | **575 across 15 tables** |
| `auth.refresh_tokens` | 139 rows |
| `auth.sessions` | 20 rows |
| `auth.mfa_amr_claims` | 20 rows |
| `public.tasks` | 72 rows |
| `public.task_sessions` | 67 rows |
| `public.projects` / `public.goals` / `public.idea_notes` | 10 / 3 / 10 rows |
| Email-like values in restored data | 4 |
| bcrypt hash markers in restored data | 2 |
| Long token-like values | 83 |
| JWT / AWS key / private-key markers | 0 / 0 / 0 |

**Conclusion: this is a data exposure, not a schema-only leak.** Exposed material includes user task/goal/note content, email addresses, bcrypt password hashes, and auth session/refresh-token rows. Severity: **high (C4-equivalent pending content review)**.

## Remediation applied

- Dump removed from the current `main` tree; `.gitignore` blocks `backups/`, `*.dump`, `*.bak`, `*.sql.gz`.
- CI guard in `.github/workflows/unified-platform-validation.yml` fails on tracked dump/backup paths.
- GitHub **secret scanning and push protection enabled** on this repository (2026-11-23).
- Local helper: `npm run security:check-backups` runs the same path guard.
- Temporary local archive copy used for inspection was shredded and deleted.

## Required owner actions (not performed here)

1. **Revoke auth sessions and refresh tokens** for the affected production project — the dump contains 139 refresh-token and 20 session rows. This requires Supabase production access, which this environment does not have.
2. **Rotate any credentials found in the restored data** and review the two bcrypt hashes; force password reset for affected users if the hashes correspond to live accounts.
3. **Notify affected users** if the four email addresses and task/note content are real production PII, per the applicable privacy policy.
4. **Request GitHub Support cache purge** for the raw blob and coordinate with the fork owner to remove their copy.
5. **Decide on a coordinated history rewrite.** It would change most of 1,444 commits, 306 branches (real collaborator work), 9 tags and every open PR, and requires temporarily disabling protection on `main`. This is a governance decision; it was not executed unilaterally.

## Residual risk

Until items 1–5 are actioned, the exposure is **active**: schema plus sample production rows, emails, password hashes and session/refresh tokens are publicly retrievable from non-main refs and the fork. A clean `git log` on `main` alone is not containment.

## Verification

- `git ls-files | grep -iE '(\.dump$|\.bak$|^backups/)'` → empty on `main`.
- `npm run security:check-backups` → exits 0 with no output.
- Repo settings: `secret_scanning: enabled`, `secret_scanning_push_protection: enabled`.
- Archive inspection: `pg_restore --data-only -f -` on the blob; aggregate counts above.
