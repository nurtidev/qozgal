CREATE TYPE "public"."body_area" AS ENUM('lower_back', 'neck', 'shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle');--> statement-breakpoint
CREATE TYPE "public"."injury_severity" AS ENUM('watch', 'pain', 'medical');--> statement-breakpoint
CREATE TABLE "injuries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"area" "body_area" NOT NULL,
	"severity" "injury_severity" DEFAULT 'pain' NOT NULL,
	"started_on" date NOT NULL,
	"resolved_on" date,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "loads_areas" text[];--> statement-breakpoint
ALTER TABLE "injuries" ADD CONSTRAINT "injuries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "injuries_user_active_idx" ON "injuries" USING btree ("user_id","resolved_on");