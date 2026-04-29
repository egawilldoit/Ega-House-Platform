# 0001. Use Deep Domain Modules for Task Workflows

## Status

Accepted

## Context

EGA House workflow centers on:

**Project -> Goal -> Task -> Timer -> Review**

Recent refactor work moved task workflow behavior out of route-local code and into deeper domain Modules. This keeps route actions thin, makes workflow behavior testable through stable public Interfaces, and gives product language a clear home in code.

Task behavior now has multiple distinct responsibilities:

- lifecycle intent and transitions
- read query fallback and normalization
- Today planning, ranking, grouping, and summary
- route-level orchestration, validation, persistence, and revalidation

Keeping these concerns mixed inside route actions makes behavior harder to test, easier to regress, and harder to reuse across `/tasks`, `/timer`, `/review`, and `/dashboard`.

## Decision

Use deep domain Modules for workflow rules.

Task transition Module owns task lifecycle intent. It decides what a transition means in product terms, including allowed state movement and intent mapping.

Task read Module owns task query, fallback, and normalization. It presents stable read behavior to callers instead of exposing route-specific query details.

Today plan builder owns Today selection, ranking, grouping, and summary. It turns available task data into the current execution plan.

Route actions should orchestrate, not own workflow rules. Actions should handle request input, auth context, server validation, calls into domain Modules, persistence, and route revalidation.

Tests should verify behavior through public Interfaces, not implementation details. Tests should assert workflow outcomes and contract behavior rather than internal helper structure.

## Consequences

Route code stays smaller and easier to review.

Task workflow behavior becomes reusable across Tasks, Timer, Review, Dashboard, Startup, and Shutdown surfaces.

Domain Modules become the primary place for workflow language and rules.

Tests become more resilient to internal refactors because they target public behavior.

Small domain Interfaces matter. If an Interface grows too broad, split it by workflow responsibility instead of moving rules back into route actions.
