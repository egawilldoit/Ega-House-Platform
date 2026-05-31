# EGA House Agent Rules

This is a Next.js application.

## Safety rules
- Never push directly to main.
- Always create a branch for Linear issues.
- Do not edit secrets, .env files, API keys, credentials, or deployment configs unless explicitly approved.
- Do not mark Linear issues as Done without human approval.
- Stop and ask if requirements are unclear.

## Workflow
- Pull one Linear issue at a time.
- Create Hermes Kanban tasks before implementation.
- Analyze first, then produce a plan.
- Wait for approval before editing files.
- Keep changes focused on the approved Linear issue.
- Show changed files and diff summary before push/PR.

## QA commands
Use npm because this repo has package-lock.json.

Baseline commands:
npm ci
npm run typecheck
npm run lint
npm test
npm run build

Known baseline:
- typecheck passes
- lint has 0 errors and 3 pre-existing warnings
- tests pass: 421 tests
- build passes: 32/32 static pages generated

## PR rules
- Branch format: hermes/<LINEAR_ID>-short-title
- PR title format: [<LINEAR_ID>] Short title
- PR body must include:
  - Linear issue
  - Summary
  - Files changed
  - Tests run
  - Risks
  - Macroscope review status

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, invoke the `skill` tool with `skill: "graphify"` before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- Graphify integrations are project-scoped via `--project` (not global). Regenerate the graph locally after cloning: `graphify update . && graphify extract .` (optional semantic pass).
- Graphify git hooks (`graphify hook install`) are not yet enabled — graph updates are manual for now.
