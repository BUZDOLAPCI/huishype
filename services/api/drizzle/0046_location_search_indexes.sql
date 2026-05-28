CREATE INDEX IF NOT EXISTS "properties_country_normalized_postal_idx"
  ON "properties" USING btree (
    "country_code",
    (REGEXP_REPLACE(UPPER("postal_code"), '\s+', '', 'g'))
  );

CREATE INDEX IF NOT EXISTS "properties_country_lower_street_idx"
  ON "properties" USING btree (
    "country_code",
    (LOWER("street"))
  );

CREATE INDEX IF NOT EXISTS "properties_country_lower_city_idx"
  ON "properties" USING btree (
    "country_code",
    (LOWER("city"))
  );
