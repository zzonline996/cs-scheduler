-- See 20260812010000_customer_schedule_saas.sql for the local full migration source.
CREATE TABLE IF NOT EXISTS public.schedule_baselines (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  month_key text NOT NULL UNIQUE,
  source_url text NOT NULL,
  source_sheet_id text NOT NULL,
  source_revision integer NOT NULL,
  payload jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.schedule_audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_key text NOT NULL,
  actor_id text NOT NULL DEFAULT auth.uid(),
  actor_username text NOT NULL,
  source_ip text,
  device_summary text NOT NULL,
  change_count integer NOT NULL CHECK (change_count >= 0),
  changes jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS schedule_audit_events_workspace_created_idx
  ON public.schedule_audit_events (workspace_key, created_at DESC);
ALTER TABLE public.schedule_baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_baselines FORCE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_audit_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.schedule_baselines FROM anon, authenticated;
REVOKE ALL ON TABLE public.schedule_audit_events FROM anon, authenticated;
GRANT SELECT ON TABLE public.schedule_baselines TO authenticated;
GRANT SELECT, INSERT ON TABLE public.schedule_audit_events TO authenticated;
DROP POLICY IF EXISTS customer_schedule_baseline_read ON public.schedule_baselines;
CREATE POLICY customer_schedule_baseline_read ON public.schedule_baselines
  FOR SELECT TO authenticated USING (auth.uid() = '2087355420017889282');
DROP POLICY IF EXISTS customer_schedule_audit_read ON public.schedule_audit_events;
DROP POLICY IF EXISTS customer_schedule_audit_insert ON public.schedule_audit_events;
CREATE POLICY customer_schedule_audit_read ON public.schedule_audit_events
  FOR SELECT TO authenticated USING (auth.uid() = '2087355420017889282');
CREATE POLICY customer_schedule_audit_insert ON public.schedule_audit_events
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = '2087355420017889282' AND actor_id = auth.uid());
