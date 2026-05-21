ALTER TYPE "public"."content_report_review_action"
  ADD VALUE IF NOT EXISTS 'disable_property_comments';--> statement-breakpoint

ALTER TYPE "public"."content_report_review_action"
  ADD VALUE IF NOT EXISTS 'enable_property_comments';--> statement-breakpoint

ALTER TYPE "public"."admin_log_action"
  ADD VALUE IF NOT EXISTS 'disable_property_comments';--> statement-breakpoint

ALTER TYPE "public"."admin_log_action"
  ADD VALUE IF NOT EXISTS 'enable_property_comments';--> statement-breakpoint

ALTER TABLE "properties"
  ADD COLUMN IF NOT EXISTS "comments_disabled_at" timestamp with time zone;--> statement-breakpoint

ALTER TABLE "properties"
  ADD COLUMN IF NOT EXISTS "comments_disabled_by" uuid;--> statement-breakpoint

ALTER TABLE "properties"
  ADD COLUMN IF NOT EXISTS "comments_disabled_reason" varchar(140);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "properties"
    ADD CONSTRAINT "properties_comments_disabled_by_users_id_fk"
    FOREIGN KEY ("comments_disabled_by") REFERENCES "public"."users"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "properties_comments_disabled_idx"
  ON "properties" USING btree ("comments_disabled_at")
  WHERE "comments_disabled_at" IS NOT NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "properties_comments_disabled_by_idx"
  ON "properties" USING btree ("comments_disabled_by");
