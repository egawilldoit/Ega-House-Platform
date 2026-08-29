-- Schema-wide MCP OAuth RLS hardening — remaining owner-scoped tables.
--
-- Tables projects/goals/tasks/task_sessions were tightened via 0041/0046/0048/0049.
-- This migration tightens the remaining tables that still allowed an MCP OAuth
-- JWT (client_id IS NOT NULL) to bypass has_active_mcp_permission via permissive
-- *_own policies (owner_user_id = auth.uid() only). After this, only
-- direct-user sessions (jwt.client_id IS NULL) can access these tables;
-- MCP tokens have zero access unless an explicit mcp_* policy exists.
-- Never weakens: only DROP permissive and ADD client_id IS NULL gate.

--> statement-breakpoint
ALTER TABLE public.week_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.week_reviews FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "week_reviews_select_own" ON public.week_reviews;
DROP POLICY IF EXISTS "week_reviews_insert_own" ON public.week_reviews;
DROP POLICY IF EXISTS "week_reviews_update_own" ON public.week_reviews;
DROP POLICY IF EXISTS "week_reviews_delete_own" ON public.week_reviews;
DROP POLICY IF EXISTS "week_reviews_direct_user_select" ON public.week_reviews;
DROP POLICY IF EXISTS "week_reviews_direct_user_insert" ON public.week_reviews;
DROP POLICY IF EXISTS "week_reviews_direct_user_update" ON public.week_reviews;
DROP POLICY IF EXISTS "week_reviews_direct_user_delete" ON public.week_reviews;
CREATE POLICY "week_reviews_direct_user_select" ON public.week_reviews FOR SELECT TO authenticated USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
CREATE POLICY "week_reviews_direct_user_insert" ON public.week_reviews FOR INSERT TO authenticated WITH CHECK (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
CREATE POLICY "week_reviews_direct_user_update" ON public.week_reviews FOR UPDATE TO authenticated USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL) WITH CHECK (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
CREATE POLICY "week_reviews_direct_user_delete" ON public.week_reviews FOR DELETE TO authenticated USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);

--> statement-breakpoint
ALTER TABLE public.idea_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idea_notes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "idea_notes_select_own" ON public.idea_notes;
DROP POLICY IF EXISTS "idea_notes_insert_own" ON public.idea_notes;
DROP POLICY IF EXISTS "idea_notes_update_own" ON public.idea_notes;
DROP POLICY IF EXISTS "idea_notes_delete_own" ON public.idea_notes;
DROP POLICY IF EXISTS "idea_notes_direct_user_select" ON public.idea_notes;
DROP POLICY IF EXISTS "idea_notes_direct_user_insert" ON public.idea_notes;
DROP POLICY IF EXISTS "idea_notes_direct_user_update" ON public.idea_notes;
DROP POLICY IF EXISTS "idea_notes_direct_user_delete" ON public.idea_notes;
CREATE POLICY "idea_notes_direct_user_select" ON public.idea_notes FOR SELECT TO authenticated USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
CREATE POLICY "idea_notes_direct_user_insert" ON public.idea_notes FOR INSERT TO authenticated WITH CHECK (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
CREATE POLICY "idea_notes_direct_user_update" ON public.idea_notes FOR UPDATE TO authenticated USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL) WITH CHECK (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
CREATE POLICY "idea_notes_direct_user_delete" ON public.idea_notes FOR DELETE TO authenticated USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);

--> statement-breakpoint
ALTER TABLE public.task_saved_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_saved_views FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "task_saved_views_select_own" ON public.task_saved_views;
DROP POLICY IF EXISTS "task_saved_views_insert_own" ON public.task_saved_views;
DROP POLICY IF EXISTS "task_saved_views_update_own" ON public.task_saved_views;
DROP POLICY IF EXISTS "task_saved_views_delete_own" ON public.task_saved_views;
DROP POLICY IF EXISTS "task_saved_views_direct_user_select" ON public.task_saved_views;
DROP POLICY IF EXISTS "task_saved_views_direct_user_insert" ON public.task_saved_views;
DROP POLICY IF EXISTS "task_saved_views_direct_user_update" ON public.task_saved_views;
DROP POLICY IF EXISTS "task_saved_views_direct_user_delete" ON public.task_saved_views;
CREATE POLICY "task_saved_views_direct_user_select" ON public.task_saved_views FOR SELECT TO authenticated USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
CREATE POLICY "task_saved_views_direct_user_insert" ON public.task_saved_views FOR INSERT TO authenticated WITH CHECK (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
CREATE POLICY "task_saved_views_direct_user_update" ON public.task_saved_views FOR UPDATE TO authenticated USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL) WITH CHECK (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
CREATE POLICY "task_saved_views_direct_user_delete" ON public.task_saved_views FOR DELETE TO authenticated USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);

--> statement-breakpoint
ALTER TABLE public.task_recurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_recurrences FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "task_recurrences_select_own" ON public.task_recurrences;
DROP POLICY IF EXISTS "task_recurrences_insert_own" ON public.task_recurrences;
DROP POLICY IF EXISTS "task_recurrences_update_own" ON public.task_recurrences;
DROP POLICY IF EXISTS "task_recurrences_delete_own" ON public.task_recurrences;
DROP POLICY IF EXISTS "task_recurrences_direct_user_select" ON public.task_recurrences;
DROP POLICY IF EXISTS "task_recurrences_direct_user_insert" ON public.task_recurrences;
DROP POLICY IF EXISTS "task_recurrences_direct_user_update" ON public.task_recurrences;
DROP POLICY IF EXISTS "task_recurrences_direct_user_delete" ON public.task_recurrences;
CREATE POLICY "task_recurrences_direct_user_select" ON public.task_recurrences FOR SELECT TO authenticated USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
CREATE POLICY "task_recurrences_direct_user_insert" ON public.task_recurrences FOR INSERT TO authenticated WITH CHECK (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
CREATE POLICY "task_recurrences_direct_user_update" ON public.task_recurrences FOR UPDATE TO authenticated USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL) WITH CHECK (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
CREATE POLICY "task_recurrences_direct_user_delete" ON public.task_recurrences FOR DELETE TO authenticated USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);

--> statement-breakpoint
ALTER TABLE public.calendar_integration_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_integration_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "calendar_integration_settings_select_own" ON public.calendar_integration_settings;
DROP POLICY IF EXISTS "calendar_integration_settings_insert_own" ON public.calendar_integration_settings;
DROP POLICY IF EXISTS "calendar_integration_settings_update_own" ON public.calendar_integration_settings;
DROP POLICY IF EXISTS "calendar_integration_settings_delete_own" ON public.calendar_integration_settings;
DROP POLICY IF EXISTS "calendar_integration_settings_direct_user_select" ON public.calendar_integration_settings;
DROP POLICY IF EXISTS "calendar_integration_settings_direct_user_insert" ON public.calendar_integration_settings;
DROP POLICY IF EXISTS "calendar_integration_settings_direct_user_update" ON public.calendar_integration_settings;
DROP POLICY IF EXISTS "calendar_integration_settings_direct_user_delete" ON public.calendar_integration_settings;
CREATE POLICY "calendar_integration_settings_direct_user_select" ON public.calendar_integration_settings FOR SELECT TO authenticated USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
CREATE POLICY "calendar_integration_settings_direct_user_insert" ON public.calendar_integration_settings FOR INSERT TO authenticated WITH CHECK (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
CREATE POLICY "calendar_integration_settings_direct_user_update" ON public.calendar_integration_settings FOR UPDATE TO authenticated USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL) WITH CHECK (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
CREATE POLICY "calendar_integration_settings_direct_user_delete" ON public.calendar_integration_settings FOR DELETE TO authenticated USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);

--> statement-breakpoint
ALTER TABLE public.calendar_sync_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_sync_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "calendar_sync_jobs_select_own" ON public.calendar_sync_jobs;
DROP POLICY IF EXISTS "calendar_sync_jobs_insert_own" ON public.calendar_sync_jobs;
DROP POLICY IF EXISTS "calendar_sync_jobs_update_own" ON public.calendar_sync_jobs;
DROP POLICY IF EXISTS "calendar_sync_jobs_delete_own" ON public.calendar_sync_jobs;
DROP POLICY IF EXISTS "calendar_sync_jobs_direct_user_select" ON public.calendar_sync_jobs;
DROP POLICY IF EXISTS "calendar_sync_jobs_direct_user_insert" ON public.calendar_sync_jobs;
DROP POLICY IF EXISTS "calendar_sync_jobs_direct_user_update" ON public.calendar_sync_jobs;
DROP POLICY IF EXISTS "calendar_sync_jobs_direct_user_delete" ON public.calendar_sync_jobs;
CREATE POLICY "calendar_sync_jobs_direct_user_select" ON public.calendar_sync_jobs FOR SELECT TO authenticated USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
CREATE POLICY "calendar_sync_jobs_direct_user_insert" ON public.calendar_sync_jobs FOR INSERT TO authenticated WITH CHECK (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
CREATE POLICY "calendar_sync_jobs_direct_user_update" ON public.calendar_sync_jobs FOR UPDATE TO authenticated USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL) WITH CHECK (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
CREATE POLICY "calendar_sync_jobs_direct_user_delete" ON public.calendar_sync_jobs FOR DELETE TO authenticated USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);

--> statement-breakpoint
ALTER TABLE public.agent_integration_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_integration_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agent_events_select_own" ON public.agent_integration_events;
DROP POLICY IF EXISTS "agent_events_insert_own" ON public.agent_integration_events;
DROP POLICY IF EXISTS "agent_events_direct_user_select" ON public.agent_integration_events;
DROP POLICY IF EXISTS "agent_events_direct_user_insert" ON public.agent_integration_events;
CREATE POLICY "agent_events_direct_user_select" ON public.agent_integration_events FOR SELECT TO authenticated USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
CREATE POLICY "agent_events_direct_user_insert" ON public.agent_integration_events FOR INSERT TO authenticated WITH CHECK (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);

--> statement-breakpoint
DROP POLICY IF EXISTS "task_reminders_select_own" ON public.task_reminders;
DROP POLICY IF EXISTS "task_reminders_insert_own" ON public.task_reminders;
DROP POLICY IF EXISTS "task_reminders_update_own" ON public.task_reminders;
DROP POLICY IF EXISTS "task_reminders_delete_own" ON public.task_reminders;

--> statement-breakpoint
ALTER TABLE public.task_external_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_external_refs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "task_external_refs_direct_user_select" ON public.task_external_refs;
DROP POLICY IF EXISTS "task_external_refs_direct_user_insert" ON public.task_external_refs;
DROP POLICY IF EXISTS "task_external_refs_direct_user_delete" ON public.task_external_refs;
CREATE POLICY "task_external_refs_direct_user_select" ON public.task_external_refs FOR SELECT TO authenticated USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
CREATE POLICY "task_external_refs_direct_user_insert" ON public.task_external_refs FOR INSERT TO authenticated WITH CHECK (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
CREATE POLICY "task_external_refs_direct_user_delete" ON public.task_external_refs FOR DELETE TO authenticated USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);

--> statement-breakpoint
DROP POLICY IF EXISTS "mcp_grants_select_own" ON public.mcp_authorization_grants;
DROP POLICY IF EXISTS "mcp_grants_direct_user_select" ON public.mcp_authorization_grants;
CREATE POLICY "mcp_grants_direct_user_select" ON public.mcp_authorization_grants FOR SELECT TO authenticated USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
