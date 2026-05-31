CREATE INDEX IF NOT EXISTS "properties_country_lower_region_idx"
  ON "properties" USING btree (
    "country_code",
    (LOWER("region"))
  );

CREATE INDEX IF NOT EXISTS "properties_country_lower_city_region_idx"
  ON "properties" USING btree (
    "country_code",
    (LOWER("city")),
    (LOWER("region"))
  );

CREATE INDEX IF NOT EXISTS "properties_country_lower_street_city_region_idx"
  ON "properties" USING btree (
    "country_code",
    (LOWER("street")),
    (LOWER("city")),
    (LOWER("region"))
  );

CREATE INDEX IF NOT EXISTS "properties_country_normalized_postal_city_region_idx"
  ON "properties" USING btree (
    "country_code",
    (REGEXP_REPLACE(UPPER("postal_code"), '\s+', '', 'g')),
    (LOWER("city")),
    (LOWER("region"))
  );
