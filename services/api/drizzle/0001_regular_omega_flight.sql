CREATE TYPE "public"."listing_source" AS ENUM('funda', 'pararius', 'other');--> statement-breakpoint
CREATE TYPE "public"."listing_status" AS ENUM('active', 'sold', 'rented', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."property_status" AS ENUM('active', 'inactive', 'demolished');--> statement-breakpoint
CREATE TYPE "public"."reaction_type" AS ENUM('like', 'love', 'wow', 'angry');--> statement-breakpoint
CREATE TYPE "public"."target_type" AS ENUM('property', 'comment');--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"parent_id" uuid,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"source_url" text NOT NULL,
	"source_name" "listing_source" NOT NULL,
	"asking_price" bigint,
	"thumbnail_url" text,
	"og_title" text,
	"status" "listing_status" DEFAULT 'active' NOT NULL,
	"mirror_listing_id" varchar(50),
	"price_type" varchar(10),
	"living_area_m2" integer,
	"num_rooms" integer,
	"energy_label" varchar(10),
	"submitted_by" uuid,
	"mirror_first_seen_at" timestamp with time zone,
	"mirror_last_changed_at" timestamp with time zone,
	"mirror_last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_guesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"guessed_price" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"listing_id" uuid,
	"price" bigint NOT NULL,
	"price_date" date NOT NULL,
	"event_type" varchar(20) NOT NULL,
	"source" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bag_identificatie" varchar(50),
	"street" varchar(255) NOT NULL,
	"house_number" integer NOT NULL,
	"house_number_addition" varchar(20),
	"city" varchar(100) NOT NULL,
	"postal_code" varchar(10) NOT NULL,
	"geometry" geometry(Point, 4326),
	"bouwjaar" integer,
	"oppervlakte" integer,
	"status" "property_status" DEFAULT 'active' NOT NULL,
	"woz_value" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "properties_bag_identificatie_unique" UNIQUE("bag_identificatie")
);
--> statement-breakpoint
CREATE TABLE "reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" "target_type" NOT NULL,
	"target_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reaction_type" "reaction_type" DEFAULT 'like' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"google_id" varchar(255),
	"apple_id" varchar(255),
	"email" varchar(255) NOT NULL,
	"username" varchar(50) NOT NULL,
	"display_name" varchar(100),
	"profile_photo_url" text,
	"karma" integer DEFAULT 0 NOT NULL,
	"internal_karma" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_google_id_unique" UNIQUE("google_id"),
	CONSTRAINT "users_apple_id_unique" UNIQUE("apple_id"),
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_guesses" ADD CONSTRAINT "price_guesses_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_guesses" ADD CONSTRAINT "price_guesses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_properties" ADD CONSTRAINT "saved_properties_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_properties" ADD CONSTRAINT "saved_properties_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_property_id_idx" ON "comments" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "comments_user_id_idx" ON "comments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "comments_parent_id_idx" ON "comments" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "comments_created_at_idx" ON "comments" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "listings_property_id_idx" ON "listings" USING btree ("property_id");--> statement-breakpoint
CREATE UNIQUE INDEX "listings_source_url_idx" ON "listings" USING btree ("source_url");--> statement-breakpoint
CREATE UNIQUE INDEX "listings_mirror_dedup_idx" ON "listings" USING btree ("source_name","mirror_listing_id") WHERE mirror_listing_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "listings_source_status_idx" ON "listings" USING btree ("source_name","status");--> statement-breakpoint
CREATE INDEX "listings_mirror_last_changed_idx" ON "listings" USING btree ("mirror_last_changed_at");--> statement-breakpoint
CREATE INDEX "listings_mirror_last_seen_idx" ON "listings" USING btree ("mirror_last_seen_at") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "price_guesses_property_id_idx" ON "price_guesses" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "price_guesses_user_id_idx" ON "price_guesses" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "price_guesses_user_property_idx" ON "price_guesses" USING btree ("user_id","property_id");--> statement-breakpoint
CREATE INDEX "price_history_property_date_idx" ON "price_history" USING btree ("property_id","price_date");--> statement-breakpoint
CREATE UNIQUE INDEX "price_history_dedup_idx" ON "price_history" USING btree ("property_id","price_date","price","event_type");--> statement-breakpoint
CREATE INDEX "price_history_listing_idx" ON "price_history" USING btree ("listing_id");--> statement-breakpoint
CREATE UNIQUE INDEX "properties_bag_id_idx" ON "properties" USING btree ("bag_identificatie");--> statement-breakpoint
CREATE INDEX "properties_city_idx" ON "properties" USING btree ("city");--> statement-breakpoint
CREATE INDEX "properties_postal_code_idx" ON "properties" USING btree ("postal_code");--> statement-breakpoint
CREATE UNIQUE INDEX "properties_address_unique_idx" ON "properties" USING btree ("postal_code","house_number","house_number_addition");--> statement-breakpoint
CREATE INDEX "reactions_target_idx" ON "reactions" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "reactions_user_id_idx" ON "reactions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reactions_user_target_idx" ON "reactions" USING btree ("user_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX "saved_properties_user_id_idx" ON "saved_properties" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_properties_user_property_idx" ON "saved_properties" USING btree ("user_id","property_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_google_id_idx" ON "users" USING btree ("google_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_apple_id_idx" ON "users" USING btree ("apple_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_idx" ON "users" USING btree ("username");
CREATE INDEX properties_geometry_gist_idx ON properties USING GIST (geometry);
