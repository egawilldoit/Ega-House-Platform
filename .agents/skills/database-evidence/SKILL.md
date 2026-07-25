---
name: database-evidence
description: >
  Use for bounded read-only Postgres or Supabase evidence about state, leases, retries, events, artifacts, or reconciliation; matching terms include rows, query, database, run events, lease, and audit. Do not use when code, Git, GitHub, or queue evidence alone answers the question.
---

# Database Evidence

## Required inputs

Environment classification, approved read-only connection method, target identifiers, and time window.

## Workflow

1. Confirm environment and read-only boundary; never print credentials.
2. Inspect schema/table/column existence before assuming deployed shape.
3. Query only rows bound to the requested owner, delivery, run, or attempt.
4. Retrieve the main record, ordered events, artifacts, claim/lease fields, retries, failures, and external references.
5. Preserve timestamps and stable identifiers needed for correlation.
6. Redact secrets and unrelated personal data.
7. Cross-check database facts against Git, queue, and external evidence instead of inferring those systems from nullable columns.

## Forbidden actions

No production mutation, repair SQL, broad table dumps, secret exposure, or status rewriting.
