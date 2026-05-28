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
