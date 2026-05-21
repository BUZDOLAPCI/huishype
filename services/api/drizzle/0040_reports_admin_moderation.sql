DO $$ BEGIN
  CREATE TYPE "public"."content_report_status" AS ENUM('unresolved', 'resolved');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "public"."content_report_review_action" AS ENUM(
    'dismiss_reports',
    'mark_property_reviewed',
    'hide_comment'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "public"."admin_log_action" AS ENUM(
    'dismiss_reports',
    'mark_property_reviewed',
    'hide_comment'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "is_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint

ALTER TABLE "comments"
  ADD COLUMN IF NOT EXISTS "hidden_at" timestamp with time zone;--> statement-breakpoint

ALTER TABLE "comments"
  ADD COLUMN IF NOT EXISTS "hidden_by" uuid;--> statement-breakpoint

ALTER TABLE "comments"
  ADD COLUMN IF NOT EXISTS "moderation_reason" varchar(140);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "comments"
    ADD CONSTRAINT "comments_hidden_by_users_id_fk"
    FOREIGN KEY ("hidden_by") REFERENCES "public"."users"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "content_reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "target_type" "target_type" NOT NULL,
  "target_id" uuid NOT NULL,
  "reporter_user_id" uuid,
  "reporter_device_id" varchar(128),
  "reason" varchar(64) NOT NULL,
  "details" varchar(140),
  "status" "content_report_status" DEFAULT 'unresolved' NOT NULL,
  "review_action" "content_report_review_action",
  "reviewed_by" uuid,
  "reviewed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "content_reports_reason_target_check" CHECK (
    (
      target_type = 'property'
      AND reason IN (
        'incorrect_property_data',
        'wrong_location',
        'wrong_listing',
        'privacy_safety',
        'spam_scam',
        'other'
      )
    )
    OR
    (
      target_type = 'comment'
      AND reason IN (
        'harassment_hate',
        'spam',
        'privacy_personal_info',
        'misleading',
        'illegal',
        'other'
      )
    )
  )
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "content_reports"
    ADD CONSTRAINT "content_reports_reporter_user_id_users_id_fk"
    FOREIGN KEY ("reporter_user_id") REFERENCES "public"."users"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "content_reports"
    ADD CONSTRAINT "content_reports_reviewed_by_users_id_fk"
    FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "admin_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "admin_user_id" uuid,
  "action" "admin_log_action" NOT NULL,
  "report_id" uuid,
  "target_type" "target_type" NOT NULL,
  "target_id" uuid NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "admin_logs"
    ADD CONSTRAINT "admin_logs_admin_user_id_users_id_fk"
    FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "admin_logs"
    ADD CONSTRAINT "admin_logs_report_id_content_reports_id_fk"
    FOREIGN KEY ("report_id") REFERENCES "public"."content_reports"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "comments_hidden_at_idx"
  ON "comments" USING btree ("hidden_at");--> statement-breakpoint

DROP INDEX IF EXISTS "comments_top_level_property_created_idx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comments_top_level_property_created_idx"
  ON "comments" USING btree ("property_id", "created_at" DESC)
  WHERE "parent_id" IS NULL AND "hidden_at" IS NULL;--> statement-breakpoint

DROP INDEX IF EXISTS "comments_replies_property_created_idx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comments_replies_property_created_idx"
  ON "comments" USING btree ("property_id", "created_at" DESC)
  WHERE "parent_id" IS NOT NULL AND "hidden_at" IS NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "content_reports_status_target_created_idx"
  ON "content_reports" USING btree ("status", "target_type", "created_at" DESC);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "content_reports_unresolved_property_queue_idx"
  ON "content_reports" USING btree ("created_at" DESC)
  WHERE "status" = 'unresolved' AND "target_type" = 'property';--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "content_reports_unresolved_comment_queue_idx"
  ON "content_reports" USING btree ("created_at" DESC)
  WHERE "status" = 'unresolved' AND "target_type" = 'comment';--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "content_reports_target_idx"
  ON "content_reports" USING btree ("target_type", "target_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "content_reports_reporter_user_idx"
  ON "content_reports" USING btree ("reporter_user_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "content_reports_created_at_idx"
  ON "content_reports" USING btree ("created_at");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "content_reports_updated_at_idx"
  ON "content_reports" USING btree ("updated_at");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "admin_logs_admin_created_idx"
  ON "admin_logs" USING btree ("admin_user_id", "created_at" DESC);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "admin_logs_action_created_idx"
  ON "admin_logs" USING btree ("action", "created_at" DESC);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "admin_logs_report_idx"
  ON "admin_logs" USING btree ("report_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "admin_logs_target_idx"
  ON "admin_logs" USING btree ("target_type", "target_id");
