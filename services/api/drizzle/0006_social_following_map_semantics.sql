ALTER TYPE "notification_event_type" ADD VALUE IF NOT EXISTS 'new_follower';
--> statement-breakpoint
CREATE TABLE "user_follows" (
	"follower_user_id" uuid NOT NULL,
	"followed_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_follows_follower_user_id_followed_user_id_pk" PRIMARY KEY("follower_user_id","followed_user_id"),
	CONSTRAINT "user_follows_not_self_chk" CHECK ("follower_user_id" <> "followed_user_id")
);
--> statement-breakpoint
ALTER TABLE "user_follows" ADD CONSTRAINT "user_follows_follower_user_id_users_id_fk" FOREIGN KEY ("follower_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "user_follows" ADD CONSTRAINT "user_follows_followed_user_id_users_id_fk" FOREIGN KEY ("followed_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "user_follows_follower_created_idx" ON "user_follows" USING btree ("follower_user_id","created_at" DESC,"followed_user_id");
--> statement-breakpoint
CREATE INDEX "user_follows_followed_created_idx" ON "user_follows" USING btree ("followed_user_id","created_at" DESC,"follower_user_id");
--> statement-breakpoint
DELETE FROM "property_views" WHERE "user_id" IS NULL AND "session_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "property_views" DROP CONSTRAINT IF EXISTS "property_views_identity_required_chk";
--> statement-breakpoint
ALTER TABLE "property_views"
  ADD CONSTRAINT "property_views_identity_required_chk"
  CHECK ("user_id" IS NOT NULL OR "session_id" IS NOT NULL);
