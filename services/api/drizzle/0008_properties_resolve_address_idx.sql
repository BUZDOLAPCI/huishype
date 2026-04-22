CREATE INDEX "properties_resolve_address_idx" ON "properties" USING btree ("country_code","postal_code","house_number","house_number_addition");
