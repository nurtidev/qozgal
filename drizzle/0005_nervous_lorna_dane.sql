ALTER TABLE "users" ADD COLUMN "reminders_on" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "weight_asked_on" date;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "waist_asked_on" date;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "awaiting_input" text;