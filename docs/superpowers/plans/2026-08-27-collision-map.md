# Pre-flight Collision Map — 2026-08-27

BASE_SHA=1a01bf3d03bf2394358f204448d247f1b04d544e

| File/interface | Owner worktree | Competing consumer | Synchronization rule |
|---|---|---|---|
| src/db/schema.ts | intelligence-foundations (EGA-523 time context) | friction-radar (EGA-499 postponement), daily-operator (EGA-526 proposal lifecycle), weekly-review (EGA-513 objectives), health-coach (none direct) | Migration lock: only intelligence-foundations holds lock first for EGA-523; others queue via Coordinator. Check drizzle/meta/_journal.json before each grant. |
| drizzle/** + _journal.json | intelligence-foundations | friction-radar, daily-operator, weekly-review | Sequential lock, fetch origin/main before grant, never duplicate tag |
| packages/application/src/index.ts + shared exports | intelligence-foundations owns shared time context + execution evidence ports | friction-radar, health-coach, weekly-review, daily-operator consume | Intelligence foundations defines canonical time-context and execution-evidence interfaces; others import, never duplicate |
| packages/contracts/src/index.ts | intelligence-foundations | health-coach, friction-radar, weekly-review, smart-inbox, daily-operator | Intelligence foundations adds time-window contracts first; others extend with feature-specific DTOs in same index but no breaking changes |
| packages/data-access/src/index.ts + repositories | intelligence-foundations | friction-radar, health-coach, weekly-review | Data-access ports for time-window data owned by intelligence-foundations; feature repos add owner-scoped queries but share supabase helper |
| packages/api-client/src/index.ts | smart-inbox (first Hono consumer) | weekly-review, friction-radar, health-coach, daily-operator | Each feature adds its own api method namespaced; no shared method collision |
| apps/server src/app.ts route registration | smart-inbox (inbox routes) | friction-radar, health-coach, weekly-review, daily-operator | Each feature registers distinct prefix (/inbox, /friction, /health, /review, /operator); Coordinator verifies no duplicate prefix |
| navigation roots (apps/web src/app, apps/mobile app/) | daily-operator owns /today canonical entry | weekly-review (/review), smart-inbox (/ideas->/inbox) | Daily-operator owns web root redirect; others add sibling routes, never hijack "/" |
| shared Today contracts | daily-operator | health-coach (Health snapshot), smart-inbox (Inbox count), friction-radar (signals) | Daily-operator defines Operator snapshot composition; others expose signals via Health/Friction/Inbox read models consumed by Operator, not vice versa |
| execution-evidence-service (apps/web lib) | intelligence-foundations migrates to packages/application | friction-radar, health-coach, weekly-review | Intelligence-foundations extracts shared logic; features delete/replace web-local duplicate only after shared port lands |
| idea_notes table | smart-inbox owns promotion | none | Smart-inbox is sole owner of idea_notes lifecycle move to application; others treat as read-only |

Rule: If two features need same canonical abstraction, owner builds it, others consume via published interface. No temporary duplicate abstraction.
Migration lock queue: intelligence-foundations -> friction-radar (EGA-499) -> daily-operator (EGA-526) -> weekly-review (EGA-513)
