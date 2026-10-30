-- Align the area-owner trigger helper with the public SECURITY DEFINER grant
-- boundary. It is a trigger, not an anonymous RPC; preserve authenticated
-- privilege while removing the default PUBLIC grant inherited from main.
REVOKE ALL ON FUNCTION public.enforce_project_area_owner() FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.enforce_project_area_owner() TO authenticated;
