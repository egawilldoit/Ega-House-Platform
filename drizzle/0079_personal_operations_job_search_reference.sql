-- Persist the optional stable job-search reference inside personal_operations.
-- Authored only: this migration is not applied by the application or tests.
--
-- The existing CHECK constraint keeps calling public.valid_personal_operations,
-- so replacing the function is sufficient. Exactly 3 keys (legacy) or 4 keys
-- including jobSearchReference are accepted; every previous target, guidance
-- and overlap check is preserved.
CREATE OR REPLACE FUNCTION public.valid_personal_operations(value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE day text; target jsonb; block jsonb; item text;
BEGIN
  IF value IS NULL THEN RETURN true; END IF;
  IF jsonb_typeof(value) <> 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(value)) NOT IN (3, 4)
     OR jsonb_typeof(value->'paused') IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(value->'targets') IS DISTINCT FROM 'object'
     OR jsonb_typeof(value->'guidance') IS DISTINCT FROM 'array'
     OR jsonb_array_length(value->'guidance') > 20
     OR (SELECT count(*) FROM jsonb_object_keys(value->'targets')) <> 7
     OR EXISTS (
       SELECT 1 FROM jsonb_object_keys(value) AS key
       WHERE key NOT IN ('paused', 'targets', 'guidance', 'jobSearchReference')
     ) THEN RETURN false; END IF;
  IF value ? 'jobSearchReference' AND jsonb_typeof(value->'jobSearchReference') <> 'null' THEN
    IF jsonb_typeof(value->'jobSearchReference') IS DISTINCT FROM 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(value->'jobSearchReference')) <> 2
       OR jsonb_typeof(value->'jobSearchReference'->'kind') IS DISTINCT FROM 'string'
       OR jsonb_typeof(value->'jobSearchReference'->'id') IS DISTINCT FROM 'string'
       OR (value->'jobSearchReference'->>'kind') NOT IN ('task', 'project')
       OR (value->'jobSearchReference'->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN RETURN false; END IF;
  END IF;
  FOREACH day IN ARRAY ARRAY['monday','tuesday','wednesday','thursday','friday','saturday','sunday'] LOOP
    target := value->'targets'->day;
    IF jsonb_typeof(target) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(target)) <> 2
       OR jsonb_typeof(target->'work') IS DISTINCT FROM 'number' OR jsonb_typeof(target->'jobSearch') IS DISTINCT FROM 'number'
       OR (target->>'work') !~ '^(0|[1-9][0-9]*)$' OR (target->>'jobSearch') !~ '^(0|[1-9][0-9]*)$'
       OR (target->>'work')::numeric > 1440 OR (target->>'jobSearch')::numeric > 1440 THEN RETURN false; END IF;
  END LOOP;
  FOR block IN SELECT * FROM jsonb_array_elements(value->'guidance') LOOP
    IF jsonb_typeof(block) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(block)) <> 5
       OR jsonb_typeof(block->'name') IS DISTINCT FROM 'string' OR length(btrim(block->>'name')) = 0 OR length(block->>'name') > 80
       OR jsonb_typeof(block->'enabled') IS DISTINCT FROM 'boolean' OR jsonb_typeof(block->'days') IS DISTINCT FROM 'array'
       OR jsonb_typeof(block->'start') IS DISTINCT FROM 'string' OR jsonb_typeof(block->'end') IS DISTINCT FROM 'string'
       OR (block->>'start') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR (block->>'end') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       OR block->>'start' >= block->>'end' THEN RETURN false; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(block->'days') d WHERE jsonb_typeof(d) <> 'string') THEN RETURN false; END IF;
    FOR item IN SELECT jsonb_array_elements_text(block->'days') LOOP
      IF item NOT IN ('monday','tuesday','wednesday','thursday','friday','saturday','sunday') THEN RETURN false; END IF;
    END LOOP;
    IF jsonb_array_length(block->'days') <> (SELECT count(DISTINCT d) FROM jsonb_array_elements(block->'days') AS d) THEN RETURN false; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(value->'guidance') WITH ORDINALITY a(b, i)
    JOIN jsonb_array_elements(value->'guidance') WITH ORDINALITY c(b, i) ON a.i < c.i
    WHERE (a.b->>'enabled')::boolean AND (c.b->>'enabled')::boolean
      AND a.b->>'start' < c.b->>'end' AND c.b->>'start' < a.b->>'end'
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(a.b->'days') d WHERE c.b->'days' @> jsonb_build_array(d))) THEN RETURN false; END IF;
  RETURN true;
EXCEPTION WHEN others THEN RETURN false;
END $$;
