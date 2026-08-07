CREATE TYPE "public"."activity_level" AS ENUM('sedentary', 'light', 'moderate', 'high', 'athlete');--> statement-breakpoint
CREATE TYPE "public"."body_type" AS ENUM('ectomorph', 'mesomorph', 'endomorph');--> statement-breakpoint
CREATE TYPE "public"."entry_source" AS ENUM('photo', 'text', 'repeat', 'barcode', 'manual');--> statement-breakpoint
CREATE TYPE "public"."entry_status" AS ENUM('pending', 'confirmed', 'discarded');--> statement-breakpoint
CREATE TYPE "public"."goal_type" AS ENUM('lose', 'maintain', 'gain');--> statement-breakpoint
CREATE TYPE "public"."locale" AS ENUM('ru', 'kk');--> statement-breakpoint
CREATE TYPE "public"."meal_type" AS ENUM('breakfast', 'lunch', 'dinner', 'snack');--> statement-breakpoint
CREATE TYPE "public"."product_source" AS ENUM('usda', 'off', 'local', 'user', 'derived');--> statement-breakpoint
CREATE TYPE "public"."sex" AS ENUM('male', 'female');--> statement-breakpoint
CREATE TABLE "body_measurements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"measured_on" date NOT NULL,
	"neck_cm" real NOT NULL,
	"waist_cm" real NOT NULL,
	"hip_cm" real,
	"chest_cm" real,
	"biceps_cm" real,
	"thigh_cm" real,
	"calf_cm" real,
	"body_fat_pct" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name_ru" text NOT NULL,
	"name_kk" text,
	"muscle_group" text NOT NULL,
	"equipment" text,
	"met_value" real
);
--> statement-breakpoint
CREATE TABLE "favorite_meals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"items" jsonb NOT NULL,
	"use_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "food_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"consumed_at" timestamp with time zone NOT NULL,
	"consumed_on" date NOT NULL,
	"meal_type" "meal_type" NOT NULL,
	"source" "entry_source" NOT NULL,
	"status" "entry_status" DEFAULT 'pending' NOT NULL,
	"photo_url" text,
	"raw_input" text,
	"ai_model" text,
	"ai_raw_response" jsonb,
	"ai_latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "food_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"product_id" uuid,
	"name_raw" text NOT NULL,
	"grams" real NOT NULL,
	"kcal" real NOT NULL,
	"protein_g" real NOT NULL,
	"fat_g" real NOT NULL,
	"carbs_g" real NOT NULL,
	"ai_confidence" real,
	"ai_estimated_grams" real,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "goal_type" NOT NULL,
	"target_weight_kg" real,
	"target_date" date,
	"weekly_rate_kg" real,
	"kcal_target" integer NOT NULL,
	"protein_target_g" real NOT NULL,
	"fat_target_g" real NOT NULL,
	"carb_target_g" real NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meal_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"goal_id" uuid,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"kcal_target" integer NOT NULL,
	"protein_target_g" real NOT NULL,
	"fat_target_g" real NOT NULL,
	"carb_target_g" real NOT NULL,
	"preferences" jsonb,
	"ai_model" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_meals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"day_index" integer NOT NULL,
	"meal_type" "meal_type" NOT NULL,
	"title" text NOT NULL,
	"recipe" text,
	"items" jsonb NOT NULL,
	"kcal" real NOT NULL,
	"protein_g" real NOT NULL,
	"fat_g" real NOT NULL,
	"carbs_g" real NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name_ru" text NOT NULL,
	"name_kk" text,
	"name_en" text,
	"brand" text,
	"source" "product_source" NOT NULL,
	"external_id" text,
	"barcode" text,
	"kcal_per_100g" real NOT NULL,
	"protein_per_100g" real NOT NULL,
	"fat_per_100g" real NOT NULL,
	"carbs_per_100g" real NOT NULL,
	"fiber_per_100g" real,
	"sugar_per_100g" real,
	"sodium_mg_per_100g" real,
	"default_portion_g" real,
	"portion_label_ru" text,
	"portion_label_kk" text,
	"is_verified" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"sex" "sex" NOT NULL,
	"birth_date" date NOT NULL,
	"height_cm" real NOT NULL,
	"activity_level" "activity_level" DEFAULT 'moderate' NOT NULL,
	"wrist_cm" real,
	"ankle_cm" real,
	"body_type" "body_type",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_id" bigint NOT NULL,
	"username" text,
	"first_name" text,
	"last_name" text,
	"photo_url" text,
	"locale" "locale" DEFAULT 'ru' NOT NULL,
	"timezone" text DEFAULT 'Asia/Almaty' NOT NULL,
	"is_blocked" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weight_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"logged_on" date NOT NULL,
	"weight_kg" real NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workout_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"days_per_week" integer NOT NULL,
	"starts_on" date NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"ai_model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workout_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_id" uuid,
	"performed_on" date NOT NULL,
	"duration_min" integer,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workout_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"set_index" integer NOT NULL,
	"weight_kg" real,
	"reps" integer,
	"rpe" real
);
--> statement-breakpoint
ALTER TABLE "body_measurements" ADD CONSTRAINT "body_measurements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorite_meals" ADD CONSTRAINT "favorite_meals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_entries" ADD CONSTRAINT "food_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_items" ADD CONSTRAINT "food_items_entry_id_food_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."food_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_items" ADD CONSTRAINT "food_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_meals" ADD CONSTRAINT "plan_meals_plan_id_meal_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."meal_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weight_logs" ADD CONSTRAINT "weight_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_plans" ADD CONSTRAINT "workout_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_plan_id_workout_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."workout_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_session_id_workout_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "body_measurements_user_date_idx" ON "body_measurements" USING btree ("user_id","measured_on");--> statement-breakpoint
CREATE INDEX "favorite_meals_user_idx" ON "favorite_meals" USING btree ("user_id","use_count" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "food_entries_user_date_idx" ON "food_entries" USING btree ("user_id","consumed_on");--> statement-breakpoint
CREATE INDEX "food_entries_user_status_idx" ON "food_entries" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "food_items_entry_idx" ON "food_items" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "goals_user_active_idx" ON "goals" USING btree ("user_id","is_active");--> statement-breakpoint
CREATE INDEX "meal_plans_user_active_idx" ON "meal_plans" USING btree ("user_id","is_active");--> statement-breakpoint
CREATE INDEX "plan_meals_plan_day_idx" ON "plan_meals" USING btree ("plan_id","day_index");--> statement-breakpoint
CREATE INDEX "products_name_ru_idx" ON "products" USING btree ("name_ru");--> statement-breakpoint
CREATE INDEX "products_barcode_idx" ON "products" USING btree ("barcode");--> statement-breakpoint
CREATE UNIQUE INDEX "products_source_external_idx" ON "products" USING btree ("source","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_telegram_id_idx" ON "users" USING btree ("telegram_id");--> statement-breakpoint
CREATE UNIQUE INDEX "weight_logs_user_date_idx" ON "weight_logs" USING btree ("user_id","logged_on");--> statement-breakpoint
CREATE INDEX "weight_logs_user_date_desc_idx" ON "weight_logs" USING btree ("user_id","logged_on" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "workout_sessions_user_date_idx" ON "workout_sessions" USING btree ("user_id","performed_on");--> statement-breakpoint
CREATE INDEX "workout_sets_session_idx" ON "workout_sets" USING btree ("session_id");