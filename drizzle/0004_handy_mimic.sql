ALTER TABLE "food_entries" ADD COLUMN "user_message_id" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "pinned_summary_id" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "pinned_summary_on" date;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tidy_chat" boolean DEFAULT true NOT NULL;