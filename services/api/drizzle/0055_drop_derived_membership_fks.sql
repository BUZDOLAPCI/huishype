ALTER TABLE "property_location_division_memberships"
  DROP CONSTRAINT IF EXISTS "property_location_division_memberships_property_id_fkey",
  DROP CONSTRAINT IF EXISTS "property_location_division_memberships_division_id_fkey",
  DROP CONSTRAINT IF EXISTS "property_location_division_memberships_division_area_id_fkey";
