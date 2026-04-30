# EGA House Context

EGA House is an execution workspace built around one product loop:

**Project -> Goal -> Task -> Timer -> Review**

Product, architecture, and UI decisions should strengthen this loop before adding new surface area.

## Product Loop

1. **Project** frames a meaningful body of work.
2. **Goal** defines the outcome inside a Project.
3. **Task** turns the Goal into executable next actions.
4. **Timer** creates focused work against the selected Task.
5. **Review** captures what happened, what changed, and what should happen next.

## Domain Terms

**Project**

Longer-lived workspace container. Projects group Goals and make execution context explicit.

**Goal**

Outcome target within a Project. Goals connect strategic intent to Tasks.

**Task**

Executable unit of work. Tasks carry lifecycle state, planning metadata, and Timer handoff intent.

**Timer**

Focused execution session for a Task. Timer flow should preserve Task context and produce useful Review data.

**Today**

Current execution plan. Today selects, ranks, groups, and summarizes Tasks that matter now.

**Startup**

Beginning-of-day or beginning-of-session planning flow. Startup turns Projects, Goals, and open Tasks into a usable Today plan.

**Shutdown**

End-of-day or end-of-session closing flow. Shutdown captures progress, unfinished work, and follow-up intent.

**Review**

Reflection and persistence surface for completed execution. Review should connect Timer evidence and Task outcomes back to Goals and Projects.

## Architecture Bias

Workflow rules belong in deep domain Modules with public Interfaces. Route actions orchestrate requests, auth, validation, persistence, and revalidation, but should not own task lifecycle rules, read fallback behavior, Today ranking, or Review semantics.
