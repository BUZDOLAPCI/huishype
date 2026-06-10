ALTER TABLE "email_auth_tokens" ADD COLUMN "code_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "email_auth_tokens" ADD COLUMN "code_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "email_auth_tokens_active_email_idx" ON "email_auth_tokens" USING btree ("email","created_at") WHERE "used_at" IS NULL;
