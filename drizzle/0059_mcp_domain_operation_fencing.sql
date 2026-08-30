-- Durable operation fencing for high-risk inserts.
--
-- The fenced receipt prevents duplicate execution while lease is live, but
-- after A commits the business effect and crashes before receipt completion,
-- lease expiry allows B to reclaim and re-execute. The receipt token fences
-- only the receipt, not the domain row. To make inserts truly idempotent,
-- persist the operation identity in the domain row with a unique constraint.
-- Second insert with same (owner, client, operation) hits 23505 and is
-- translated to a replay instead of a duplicate row.

--> statement-breakpoint
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS mcp_operation_id uuid;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS mcp_client_id text;

--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS projects_mcp_operation_unique
  ON public.projects (owner_user_id, mcp_client_id, mcp_operation_id)
  WHERE mcp_operation_id IS NOT NULL;

--> statement-breakpoint
ALTER TABLE public.goals ADD COLUMN IF NOT EXISTS mcp_operation_id uuid;
ALTER TABLE public.goals ADD COLUMN IF NOT EXISTS mcp_client_id text;

--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS goals_mcp_operation_unique
  ON public.goals (owner_user_id, mcp_client_id, mcp_operation_id)
  WHERE mcp_operation_id IS NOT NULL;

--> statement-breakpoint
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS mcp_operation_id uuid;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS mcp_client_id text;

--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS tasks_mcp_operation_unique
  ON public.tasks (owner_user_id, mcp_client_id, mcp_operation_id)
  WHERE mcp_operation_id IS NOT NULL;

--> statement-breakpoint
ALTER TABLE public.task_reminders ADD COLUMN IF NOT EXISTS mcp_operation_id uuid;
ALTER TABLE public.task_reminders ADD COLUMN IF NOT EXISTS mcp_client_id text;

--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS task_reminders_mcp_operation_unique
  ON public.task_reminders (owner_user_id, mcp_client_id, mcp_operation_id)
  WHERE mcp_operation_id IS NOT NULL;

--> statement-breakpoint
ALTER TABLE public.task_sessions ADD COLUMN IF NOT EXISTS mcp_operation_id uuid;
ALTER TABLE public.task_sessions ADD COLUMN IF NOT EXISTS mcp_client_id text;

--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS task_sessions_mcp_operation_unique
  ON public.task_sessions (owner_user_id, mcp_client_id, mcp_operation_id)
  WHERE mcp_operation_id IS NOT NULL;
