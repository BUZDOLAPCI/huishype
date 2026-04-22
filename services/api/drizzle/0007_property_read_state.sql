CREATE TABLE "property_change_state" (
  "property_id" uuid PRIMARY KEY NOT NULL,
  "change_version" bigint DEFAULT 0 NOT NULL,
  "last_changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "property_change_state" ADD CONSTRAINT "property_change_state_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "property_change_state_last_changed_at_idx" ON "property_change_state" USING btree ("last_changed_at");
--> statement-breakpoint
CREATE TABLE "property_read_state" (
  "property_id" uuid NOT NULL,
  "user_id" uuid,
  "session_id" text,
  "seen_change_version" bigint NOT NULL,
  "seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "property_read_state_exactly_one_identity_chk" CHECK (("user_id" IS NULL) <> ("session_id" IS NULL)),
  CONSTRAINT "property_read_state_session_not_blank_chk" CHECK ("session_id" IS NULL OR BTRIM("session_id") <> '')
);
--> statement-breakpoint
ALTER TABLE "property_read_state" ADD CONSTRAINT "property_read_state_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "property_read_state" ADD CONSTRAINT "property_read_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "property_read_state_user_property_idx" ON "property_read_state" USING btree ("user_id","property_id") WHERE user_id IS NOT NULL AND session_id IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "property_read_state_session_property_idx" ON "property_read_state" USING btree ("session_id","property_id") WHERE session_id IS NOT NULL AND user_id IS NULL;
--> statement-breakpoint
CREATE INDEX "property_read_state_anonymous_seen_at_idx" ON "property_read_state" USING btree ("seen_at") WHERE session_id IS NOT NULL AND user_id IS NULL;
