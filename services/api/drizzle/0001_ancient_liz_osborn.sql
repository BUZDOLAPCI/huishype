CREATE TABLE "property_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"user_id" uuid,
	"session_id" text,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "price_guesses" ADD COLUMN "is_meme_guess" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_display_name_change_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "property_views" ADD CONSTRAINT "property_views_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_views" ADD CONSTRAINT "property_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "property_views_property_user_idx" ON "property_views" USING btree ("property_id","user_id");--> statement-breakpoint
CREATE INDEX "property_views_property_session_idx" ON "property_views" USING btree ("property_id","session_id");--> statement-breakpoint
CREATE INDEX "property_views_property_viewed_at_idx" ON "property_views" USING btree ("property_id","viewed_at");