---
name: database-evidence
description: Bounded read-only collection of EGA House product or automation database evidence. Use when a task requires chronological state, lease, retry, event, artifact, or reconciliation facts from Postgres/Supabase.
---

# Database Evidence

## Required inputs
Environment classification, approved read-only connection method, target entity identifiers, and time window.

## Workflow
1. Confirm the environment and read-only boundary; never print credentials.
2. Inspect schema/table/column existence before assuming deployed shape.
3. Query only rows bound to the requested owner/delivery/run/attempt identifiers.
4. Retrieve the main record, ordered events, artifacts, claim/lease fields, retry/read counts, failure fields, and external references.
5. Preserve timestamps/time zones and row identifiers needed for correlation.
6. Redact secrets, tokens, personal data not required for diagnosis, and large payload bodies.
7. Cross-check database facts against Git/queue/external evidence instead of inferring those systems from nullable columns.

## Forbidden actions
No production mutation, repair SQL, broad table dumps, secret exposure, or status rewriting.

## Output contract
Queries or query shapes used, bounded result summary, chronological evidence, missing schema/data, and confidence classification.
