CREATE TYPE "public"."workout_feeling" AS ENUM('easy', 'normal', 'hard', 'pain');--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD COLUMN "feeling" "workout_feeling";--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD COLUMN "painful_exercise_id" uuid;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_painful_exercise_id_exercises_id_fk" FOREIGN KEY ("painful_exercise_id") REFERENCES "public"."exercises"("id") ON DELETE set null ON UPDATE no action;