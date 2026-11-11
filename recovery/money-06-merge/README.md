# MONEY-06 incomplete merge recovery snapshot

Not merge-ready. This is a backup, not resolved source. The original merge remains in its worktree.

- HEAD: 31a7c099da281c4d1cedb16f2c8fa7a41166a4aa
- MERGE_HEAD: 3002a5e03299531cf3a35eb04b6d232cd2906e27
- `working-tree/` contains current changed file bytes including conflict markers. `index/stage-N/` contains every available index stage for changed paths; `index-inventory.txt` records modes and blob IDs. `status.txt` records the original status.
- No untracked source files were present at capture. Build output, dependencies, environment files and secrets are excluded.
- Tests were not run for this checkpoint. MONEY-05 PR 396 previously reported failing lint-changed, web and hygiene checks.

## Unresolved conflicts

- AA apps/server/src/routes/money.ts
- UU apps/web/src/app/(workspace)/money/page.tsx
- UU apps/web/src/lib/mcp/audited-read-handlers.test.ts
- UU apps/web/src/lib/mcp/audited-read-handlers.ts
- UU apps/web/src/lib/mcp/audited-write-handlers.ts
- UU apps/web/src/lib/mcp/money-01-migration.test.ts
- UU apps/web/src/lib/mcp/read-tool-handlers.ts
- UU apps/web/src/lib/mcp/server.test.ts
- UU apps/web/src/lib/mcp/server.ts
- UU apps/web/src/lib/mcp/tool-discovery.ts
- UU apps/web/src/lib/mcp/write-tool-handlers.ts
- UU drizzle/meta/_journal.json
- UU packages/api-client/src/client.ts
- UU packages/api-client/src/index.ts
- AA packages/api-client/src/money.ts
- UU packages/application/package.json
- AA packages/contracts/src/money.ts
- UU packages/data-access/package.json
- UU packages/domain/package.json
- UU packages/domain/src/index.ts
- UU src/db/schema.ts
