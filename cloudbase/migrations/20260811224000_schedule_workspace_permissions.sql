-- CloudBase PG permissions for the single shared Wuhan customer-service schedule.
-- The browser uses an anonymous CloudBase session; it may only access this one row.

REVOKE ALL ON TABLE public.schedule_workspaces FROM authenticated;
GRANT SELECT, UPDATE ON TABLE public.schedule_workspaces TO anon;

CREATE POLICY schedule_workspace_anon_read
  ON public.schedule_workspaces
  FOR SELECT
  TO anon
  USING (workspace_key = 'wuhan-customer-service-current');

CREATE POLICY schedule_workspace_anon_update
  ON public.schedule_workspaces
  FOR UPDATE
  TO anon
  USING (workspace_key = 'wuhan-customer-service-current')
  WITH CHECK (workspace_key = 'wuhan-customer-service-current');
