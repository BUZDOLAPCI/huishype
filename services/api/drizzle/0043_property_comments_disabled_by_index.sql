CREATE INDEX IF NOT EXISTS "properties_comments_disabled_by_idx"
  ON "properties" USING btree ("comments_disabled_by");
