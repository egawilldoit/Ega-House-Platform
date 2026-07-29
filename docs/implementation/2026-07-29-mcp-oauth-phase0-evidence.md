# EGA House MCP OAuth — Phase 0 Evidence

Date: 2026-07-29
Branch: `feat/mcp-oauth-integration`
Base commit: `a1d3ca6bc1bc0df6848077622af5a84d2ec284f9`
Supabase project: `Ega-House-Platform` (`ofpqkogwatceimtzvenh`)

## Purpose

Record the read-only production evidence that governs MCP implementation before any database or OAuth mutation. This document is evidence, not authority for changing production state.

## Verified production findings

### 1. Agent audit schema mismatch

The deployed `public.agent_integration_events` table currently contains:

- `owner_user_id uuid not null`
- `token_id uuid not null`
- `action varchar(64) not null`
- `resource_type varchar(32)`
- `resource_id uuid`
- `outcome varchar(16) not null`
- `ip_address varchar(45)`
- `created_at timestamptz not null default now()`

It does not contain a `metadata` column. Current task create/update code writes `metadata` and omits the required `outcome`, so those audit inserts are structurally incompatible with the deployed schema.

### 2. RLS is disabled on core product tables

RLS is disabled on the current deployed product tables used by the proposed MCP read tools, including:

- `public.projects`
- `public.goals`
- `public.tasks`

RLS is also disabled on the current automation tables. Therefore, a request-scoped user Supabase client is not yet a tenant-isolation boundary. The MCP route must not be enabled until reviewed RLS policies or an equally strong owner-scoped repository boundary is proven.

### 3. Existing integration tables

The deployed database includes:

- `public.agent_integration_tokens` with RLS enabled
- `public.agent_integration_events` with RLS enabled
- `public.task_external_refs` with RLS enabled

The unique `(owner_user_id, source, source_id)` index on `task_external_refs` is available for idempotency.

### 4. Runner migration drift

The repository contains migrations `0035_automation_implementation_runs.sql` and `0036_runner_pr_watch_repair_graph.sql`. The deployed `automation.implementation_runs` table contains the `0035` fields but does not currently show the complete `0036` PR-watch/repair fields. This must be reconciled before exposing Runner observability tools.

## Safety decisions

1. Do not apply RLS changes directly to production without policy review and a rollback plan.
2. Do not enable MCP reads until tenant isolation is proven.
3. Do not enable MCP writes until task mutation and audit/outbox persistence are atomic.
4. Keep the current custom-token Agent API operational while the shared application-service boundary is introduced.
5. All Supabase DDL must first be validated on a development branch or equivalent disposable environment.

## Phase 0 implementation order

1. Repair task archive owner fencing and audit payload construction in code.
2. Add a versioned migration that reconciles the unified audit schema and introduces MCP grants.
3. Add reviewed RLS policies for the read-only MCP resource set.
4. Validate migration and policies on a Supabase development branch.
5. Generate and commit updated TypeScript database types.
6. Only then add the OAuth-protected MCP transport and read-only tools.
