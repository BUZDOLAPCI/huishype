CREATE TABLE "refresh_token_revocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_id" varchar(255) NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "refresh_token_revocations" ADD CONSTRAINT "refresh_token_revocations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "refresh_token_revocations_token_id_idx" ON "refresh_token_revocations" USING btree ("token_id");--> statement-breakpoint
CREATE INDEX "refresh_token_revocations_user_id_idx" ON "refresh_token_revocations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_token_revocations_expires_at_idx" ON "refresh_token_revocations" USING btree ("expires_at");