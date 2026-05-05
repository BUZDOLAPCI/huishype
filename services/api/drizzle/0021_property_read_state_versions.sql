CREATE TABLE IF NOT EXISTS "property_read_state_versions" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" uuid,
  "session_id" text,
  "version" bigint DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "property_read_state_versions_exactly_one_identity_chk" CHECK (("user_id" IS NULL) <> ("session_id" IS NULL)),
  CONSTRAINT "property_read_state_versions_session_not_blank_chk" CHECK ("session_id" IS NULL OR BTRIM("session_id") <> '')
);
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "property_read_state_versions"
    ADD CONSTRAINT "property_read_state_versions_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "property_read_state_versions_user_idx"
ON "property_read_state_versions" USING btree ("user_id")
WHERE user_id IS NOT NULL AND session_id IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "property_read_state_versions_session_idx"
ON "property_read_state_versions" USING btree ("session_id")
WHERE session_id IS NOT NULL AND user_id IS NULL;
--> statement-breakpoint
INSERT INTO "property_read_state_versions" ("user_id", "session_id", "version", "updated_at")
SELECT
  "user_id",
  "session_id",
  COUNT(*)::bigint,
  MAX("seen_at")
FROM "property_read_state"
GROUP BY "user_id", "session_id"
ON CONFLICT DO NOTHING;
