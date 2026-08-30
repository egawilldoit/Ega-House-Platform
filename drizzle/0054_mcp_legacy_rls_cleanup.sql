-- MCP legacy RLS cleanup — remove permissive *_own policies that bypass
-- the hardened MCP permission checks (0038/0041/0046). These legacy policies
-- only check owner_user_id = auth.uid() without validating the OAuth client
-- or the workspace_manager permission, so a read_only grant could still write.
-- Dropping them tightens RLS; no new permissive policy is added.

--> statement-breakpoint
DROP POLICY IF EXISTS "projects_select_own" ON public.projects;
DROP POLICY IF EXISTS "projects_insert_own" ON public.projects;
DROP POLICY IF EXISTS "projects_update_own" ON public.projects;
DROP POLICY IF EXISTS "projects_delete_own" ON public.projects;

--> statement-breakpoint
DROP POLICY IF EXISTS "goals_select_own" ON public.goals;
DROP POLICY IF EXISTS "goals_insert_own" ON public.goals;
DROP POLICY IF EXISTS "goals_update_own" ON public.goals;
DROP POLICY IF EXISTS "goals_delete_own" ON public.goals;

--> statement-breakpoint
DROP POLICY IF EXISTS "tasks_select_own" ON public.tasks;
DROP POLICY IF EXISTS "tasks_insert_own" ON public.tasks;
DROP POLICY IF EXISTS "tasks_update_own" ON public.tasks;
DROP POLICY IF EXISTS "tasks_delete_own" ON public.tasks;

--> statement-breakpoint
DROP POLICY IF EXISTS "task_sessions_select_own" ON public.task_sessions;
DROP POLICY IF EXISTS "task_sessions_insert_own" ON public.task_sessions;
DROP POLICY IF EXISTS "task_sessions_update_own" ON public.task_sessions;
DROP POLICY IF EXISTS "task_sessions_delete_own" ON public.task_sessions;
