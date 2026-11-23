-- MONEY-001-B: November workbook adoption evidence.
--
-- This migration adds exactly one owner-scoped evidence/receipt table. It is
-- NOT a ledger: financial rows stay in personal_expenses and are written only
-- through the canonical Money application paths. The table stores the frozen
-- source snapshot, the exact approved manifest, the approval object and the
-- post-apply reconciliation so a retry can resume or replay without re-deriving
-- a different digest from a changed target.
--
-- Additive only. No existing table, column, value or policy is rewritten.

CREATE TABLE IF NOT EXISTS public.money_import_adoptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  owner_user_id uuid DEFAULT auth.uid() NOT NULL,
  snapshot_id varchar(64) NOT NULL,
  snapshot_digest char(64) NOT NULL,
  manifest_digest char(64) NOT NULL,
  source_identity varchar(512) NOT NULL,
  target_environment varchar(64) NOT NULL,
  opening_strategy varchar(32) NOT NULL,
  cutover_date date NOT NULL,
  status varchar(24) DEFAULT 'applying' NOT NULL,
  snapshot jsonb NOT NULL,
  manifest jsonb NOT NULL,
  approval jsonb NOT NULL,
  applied_counts jsonb,
  post_reconciliation jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  applied_at timestamp with time zone,
  CONSTRAINT money_import_adoptions_snapshot_id_check
    CHECK (btrim(snapshot_id) <> ''),
  CONSTRAINT money_import_adoptions_snapshot_digest_check
    CHECK (btrim(snapshot_digest) ~ '^[0-9a-f]{64}$'),
  CONSTRAINT money_import_adoptions_manifest_digest_check
    CHECK (btrim(manifest_digest) ~ '^[0-9a-f]{64}$'),
  CONSTRAINT money_import_adoptions_source_identity_check
    CHECK (btrim(source_identity) <> ''),
  CONSTRAINT money_import_adoptions_environment_check
    CHECK (btrim(target_environment) <> ''),
  CONSTRAINT money_import_adoptions_opening_strategy_check
    CHECK (opening_strategy IN ('verified_cutover_opening', 'full_history')),
  CONSTRAINT money_import_adoptions_status_check
    CHECK (status IN ('applying', 'adopted', 'review_needed')),
  CONSTRAINT money_import_adoptions_snapshot_object_check
    CHECK (jsonb_typeof(snapshot) = 'object'),
  CONSTRAINT money_import_adoptions_manifest_object_check
    CHECK (jsonb_typeof(manifest) = 'object'),
  CONSTRAINT money_import_adoptions_approval_object_check
    CHECK (jsonb_typeof(approval) = 'object'),
  CONSTRAINT money_import_adoptions_applied_counts_object_check
    CHECK (applied_counts IS NULL OR jsonb_typeof(applied_counts) = 'object'),
  CONSTRAINT money_import_adoptions_post_reconciliation_object_check
    CHECK (post_reconciliation IS NULL OR jsonb_typeof(post_reconciliation) = 'object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS money_import_adoptions_owner_snapshot_unique
  ON public.money_import_adoptions USING btree (owner_user_id, snapshot_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS money_import_adoptions_owner_status_idx
  ON public.money_import_adoptions USING btree (owner_user_id, status, updated_at DESC);
--> statement-breakpoint
ALTER TABLE public.money_import_adoptions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.money_import_adoptions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS money_import_adoptions_select ON public.money_import_adoptions;
CREATE POLICY money_import_adoptions_select ON public.money_import_adoptions
  FOR SELECT TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND (
      ((SELECT auth.jwt()) ->> 'client_id') IS NULL
      OR public.mcp_finance_grant_allows('personal_ops.read')
    )
  );
--> statement-breakpoint
DROP POLICY IF EXISTS money_import_adoptions_insert ON public.money_import_adoptions;
CREATE POLICY money_import_adoptions_insert ON public.money_import_adoptions
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND (
      ((SELECT auth.jwt()) ->> 'client_id') IS NULL
      OR public.mcp_finance_grant_allows('personal_ops.write')
    )
  );
--> statement-breakpoint
DROP POLICY IF EXISTS money_import_adoptions_update ON public.money_import_adoptions;
CREATE POLICY money_import_adoptions_update ON public.money_import_adoptions
  FOR UPDATE TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND (
      ((SELECT auth.jwt()) ->> 'client_id') IS NULL
      OR public.mcp_finance_grant_allows('personal_ops.write')
    )
  )
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND (
      ((SELECT auth.jwt()) ->> 'client_id') IS NULL
      OR public.mcp_finance_grant_allows('personal_ops.write')
    )
  );
--> statement-breakpoint
-- No DELETE policy and no DELETE grant: adoption evidence is retained.
REVOKE ALL ON TABLE public.money_import_adoptions FROM anon;
--> statement-breakpoint
REVOKE ALL ON TABLE public.money_import_adoptions FROM authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE public.money_import_adoptions TO authenticated;
--> statement-breakpoint
GRANT INSERT ON TABLE public.money_import_adoptions TO authenticated;
--> statement-breakpoint
GRANT UPDATE (
  status,
  applied_counts,
  post_reconciliation,
  applied_at,
  updated_at
) ON TABLE public.money_import_adoptions TO authenticated;
