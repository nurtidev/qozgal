CREATE TABLE "plan_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"day_index" integer NOT NULL,
	"focus" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"pattern" text NOT NULL,
	"sets" integer NOT NULL,
	"rep_min" integer,
	"rep_max" integer,
	"duration_min" integer,
	"rest_sec" integer
);
--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "pattern" text;--> statement-breakpoint
ALTER TABLE "workout_plans" ADD COLUMN "place" text DEFAULT 'gym' NOT NULL;--> statement-breakpoint
ALTER TABLE "workout_plans" ADD COLUMN "goal_type" "goal_type";--> statement-breakpoint
ALTER TABLE "workout_plans" ADD COLUMN "level" text;--> statement-breakpoint
ALTER TABLE "workout_plans" ADD COLUMN "skipped" jsonb;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD COLUMN "plan_day_id" uuid;--> statement-breakpoint
ALTER TABLE "plan_days" ADD CONSTRAINT "plan_days_plan_id_workout_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."workout_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_exercises" ADD CONSTRAINT "plan_exercises_day_id_plan_days_id_fk" FOREIGN KEY ("day_id") REFERENCES "public"."plan_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_exercises" ADD CONSTRAINT "plan_exercises_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plan_days_plan_index_idx" ON "plan_days" USING btree ("plan_id","day_index");--> statement-breakpoint
CREATE INDEX "plan_exercises_day_idx" ON "plan_exercises" USING btree ("day_id","sort_order");--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_plan_day_id_plan_days_id_fk" FOREIGN KEY ("plan_day_id") REFERENCES "public"."plan_days"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workout_plans_user_active_idx" ON "workout_plans" USING btree ("user_id","is_active");