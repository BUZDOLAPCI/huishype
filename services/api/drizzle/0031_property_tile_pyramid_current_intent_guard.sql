CREATE OR REPLACE FUNCTION property_tile_pyramid_current_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  referenced_version "property_tile_pyramid_versions"%ROWTYPE;
  has_intent boolean;
BEGIN
  SELECT *
    INTO referenced_version
  FROM "property_tile_pyramid_versions" v
  WHERE v."id" = NEW."current_version_id"
    AND v."coverage_id" = NEW."coverage_id"
    AND v."filter_signature" = NEW."filter_signature"
    AND v."max_zoom" = NEW."max_zoom"
    AND v."pyramid_kind" = NEW."pyramid_kind";

  IF referenced_version."id" IS NULL THEN
    RAISE EXCEPTION 'current pyramid version % does not match serving slot', NEW."current_version_id";
  END IF;

  has_intent = property_tile_pyramid_has_promotion_intent(
    txid_current(),
    NEW."current_version_id",
    NEW."coverage_id",
    NEW."filter_signature",
    NEW."max_zoom",
    NEW."pyramid_kind"
  );

  IF referenced_version."status" <> 'promoted'
    AND NOT (
      referenced_version."status" = 'validated'
      AND has_intent
    )
  THEN
    RAISE EXCEPTION 'current pyramid version % must be promoted, got %',
      NEW."current_version_id",
      referenced_version."status";
  END IF;

  IF (TG_OP = 'INSERT' OR NEW."current_version_id" IS DISTINCT FROM OLD."current_version_id")
    AND NOT has_intent
  THEN
    RAISE EXCEPTION 'current pyramid pointer changes must use promote_property_tile_pyramid_version';
  END IF;

  IF TG_OP = 'INSERT'
    AND NEW."previous_version_id" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "property_tile_pyramid_current" c
      WHERE c."coverage_id" = NEW."coverage_id"
        AND c."filter_signature" = NEW."filter_signature"
        AND c."max_zoom" = NEW."max_zoom"
        AND c."pyramid_kind" = NEW."pyramid_kind"
    )
  THEN
    RAISE EXCEPTION 'initial current pointer insert must not declare a previous version';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW."coverage_id" IS DISTINCT FROM OLD."coverage_id"
      OR NEW."filter_signature" IS DISTINCT FROM OLD."filter_signature"
      OR NEW."max_zoom" IS DISTINCT FROM OLD."max_zoom"
      OR NEW."pyramid_kind" IS DISTINCT FROM OLD."pyramid_kind"
    THEN
      RAISE EXCEPTION 'property tile pyramid current serving slot is immutable';
    END IF;

    IF NEW."current_version_id" IS DISTINCT FROM OLD."current_version_id"
      AND NEW."previous_version_id" IS DISTINCT FROM OLD."current_version_id"
    THEN
      RAISE EXCEPTION 'current pointer updates must record the old current version as previous_version_id';
    END IF;

    NEW."updated_at" = now();
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION promote_property_tile_pyramid_version(
  p_target_version_id uuid,
  p_expected_previous_version_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_actor text DEFAULT 'system'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_version "property_tile_pyramid_versions"%ROWTYPE;
  pointer_updated integer;
  current_txid bigint;
  audit_action "property_tile_pyramid_audit_action";
BEGIN
  current_txid = txid_current();

  SELECT *
    INTO target_version
  FROM "property_tile_pyramid_versions"
  WHERE "id" = p_target_version_id
  FOR UPDATE;

  IF target_version."id" IS NULL THEN
    RAISE EXCEPTION 'property tile pyramid version % not found', p_target_version_id;
  END IF;

  IF target_version."status" NOT IN ('validated', 'promoted') THEN
    RAISE EXCEPTION 'property tile pyramid version % must be validated or promoted before pointer update, got %',
      p_target_version_id,
      target_version."status";
  END IF;

  audit_action = CASE
    WHEN target_version."status" = 'validated' THEN 'promoted'::property_tile_pyramid_audit_action
    ELSE 'rollback'::property_tile_pyramid_audit_action
  END;

  INSERT INTO "property_tile_pyramid_promotion_intents" (
    "txid",
    "version_id",
    "coverage_id",
    "filter_signature",
    "max_zoom",
    "pyramid_kind",
    "actor",
    "reason"
  )
  VALUES (
    current_txid,
    p_target_version_id,
    target_version."coverage_id",
    target_version."filter_signature",
    target_version."max_zoom",
    target_version."pyramid_kind",
    COALESCE(p_actor, 'system'),
    p_reason
  )
  ON CONFLICT ("txid", "version_id") DO NOTHING;

  PERFORM property_tile_pyramid_assert_promotable(p_target_version_id);

  WITH upserted AS (
    INSERT INTO "property_tile_pyramid_current" (
      "coverage_id",
      "filter_signature",
      "max_zoom",
      "pyramid_kind",
      "current_version_id",
      "previous_version_id",
      "current_promoted_at",
      "promotion_reason",
      "updated_at"
    )
    VALUES (
      target_version."coverage_id",
      target_version."filter_signature",
      target_version."max_zoom",
      target_version."pyramid_kind",
      p_target_version_id,
      p_expected_previous_version_id,
      now(),
      p_reason,
      now()
    )
    ON CONFLICT ("coverage_id", "filter_signature", "max_zoom", "pyramid_kind")
    DO UPDATE SET
      "current_version_id" = EXCLUDED."current_version_id",
      "previous_version_id" = "property_tile_pyramid_current"."current_version_id",
      "current_promoted_at" = EXCLUDED."current_promoted_at",
      "promotion_reason" = EXCLUDED."promotion_reason",
      "updated_at" = now()
    WHERE "property_tile_pyramid_current"."current_version_id" IS NOT DISTINCT FROM p_expected_previous_version_id
    RETURNING 1
  )
  SELECT count(*) INTO pointer_updated FROM upserted;

  IF pointer_updated <> 1 THEN
    RAISE EXCEPTION 'property tile pyramid current pointer compare-and-swap failed for version %',
      p_target_version_id;
  END IF;

  UPDATE "property_tile_pyramid_versions"
  SET
    "status" = 'promoted',
    "promoted_at" = COALESCE("promoted_at", now()),
    "updated_at" = now()
  WHERE "id" = p_target_version_id
    AND "status" = 'validated';

  INSERT INTO "property_tile_pyramid_audit" (
    "version_id",
    "coverage_id",
    "filter_signature",
    "max_zoom",
    "pyramid_kind",
    "action",
    "actor",
    "from_status",
    "to_status",
    "previous_version_id",
    "current_version_id",
    "reason"
  )
  VALUES (
    p_target_version_id,
    target_version."coverage_id",
    target_version."filter_signature",
    target_version."max_zoom",
    target_version."pyramid_kind",
    audit_action,
    COALESCE(p_actor, 'system'),
    target_version."status",
    'promoted',
    p_expected_previous_version_id,
    p_target_version_id,
    p_reason
  );
END;
$$;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'huishype_pyramid_owner') THEN
    ALTER FUNCTION property_tile_pyramid_current_guard() OWNER TO huishype_pyramid_owner;
    ALTER FUNCTION promote_property_tile_pyramid_version(uuid, uuid, text, text)
      OWNER TO huishype_pyramid_owner;
  END IF;
END $$;--> statement-breakpoint
