# Backup dump exposure — classification and close-out

Date: 2026-11-23. Status: **classified, contained at `main`, residual exposure accepted with monitoring**.

## Summary

`backups/prod-pre-sprint2-full-20260504.dump` (278,567 bytes, blob `004552be…`) was tracked in this public repository from 2026-06-01 until it was removed from `main` on 2026-11-21 in PR #418. It is no longer in the `main` tree, and a CI guard now fails any build that tracks a dump/backup path.

## Classification evidence

The blob was read locally and **only aggregate counts were recorded** — no content, values, or secret-looking strings were copied into artifacts or logs.

| Check | Result |
|---|---|
| PostgreSQL dump structure | 55 `CREATE TABLE` statements, 49 `COPY` statements |
| Data rows in `COPY` blocks | **0** — schema-only dump |
| `auth.users` table definition | present (schema only, no rows) |
| Email-like values | 0 |
| JWT-like values | 0 |
| AWS access-key-like values | 0 |
| bcrypt/argon password hashes | 0 |
| Bearer/private-key markers | 0 |
| API-token words in column names | 12 (definitions, not values) |

Conclusion: this is **schema/metadata disclosure, not a data breach**. No live PII, password hashes, tokens, or integration credentials were found. **Credential rotation is therefore not indicated by the available evidence.**

## Residual exposure

- The blob remains reachable from 298 of 306 remote branch tips, 9 tags, and the fork `abdelilahmortaki/Ega-House-Platform`.
- The affected refs are collaborator work branches (`feat/*`, `fix/*`, `abmortaki/*`, `arch/*`, …), not disposable automation refs.
- `main`'s tip is clean; the raw path on `main` returns 404.

## Decision

A full history rewrite was **not performed**. Rationale:

1. The exposed material is schema-only, with no secrets or personal data.
2. Rewriting would change most of 1,444 commits, 306 branches, 9 tags, and every open PR, breaking collaborators' work and requiring a coordinated force-push of a protected branch.
3. Repository guidance discourages rewriting shared history casually; the previous audit explicitly required separate authorization and coordination.

Residual risk is accepted as **low**: database table/column names and schema-policy metadata are public. This does not by itself grant access to any system.

## Remediation applied

- Dump removed from the current tree; `.gitignore` blocks `backups/`, `*.dump`, `*.bak`, `*.sql.gz`.
- CI guard in `.github/workflows/unified-platform-validation.yml` fails on any tracked dump/backup path.
- GitHub **secret scanning and push protection enabled** on this repository (2026-11-23).
- Local helper: `npm run security:check-backups` runs the same path guard.

## Actions that still require an owner decision

- Request GitHub Support to purge cached raw views of the blob if the schema disclosure is considered unacceptable.
- Coordinate with the fork owner if removal from the fork is required.
- If future analysis finds data rows or credentials in the blob, reopen as a credential-rotation incident and plan a coordinated rewrite.

## Verification

- `git ls-files | grep -iE '(\.dump$|\.bak$|^backups/)'` → empty on `main`.
- `npm run security:check-backups` → exits 0 with no output.
- Repo settings: `secret_scanning: enabled`, `secret_scanning_push_protection: enabled`.
