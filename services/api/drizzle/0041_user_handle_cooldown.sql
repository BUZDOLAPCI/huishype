ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "last_username_change_at" timestamp with time zone;
