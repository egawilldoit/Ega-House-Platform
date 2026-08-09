ALTER TABLE "idea_notes"
  DROP CONSTRAINT IF EXISTS "idea_notes_status_check",
  ADD CONSTRAINT "idea_notes_status_check"
    CHECK ("status" in ('inbox', 'reviewing', 'planned', 'archived', 'converted'));
