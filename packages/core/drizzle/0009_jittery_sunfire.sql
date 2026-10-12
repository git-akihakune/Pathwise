CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"session_id" uuid,
	"message_id" uuid,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"target_id" uuid,
	"target_version" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "proposals_kind" CHECK ("proposals"."kind" in ('profile_update', 'memory_add', 'memory_update', 'story_add', 'story_update', 'path_save', 'plan_create', 'plan_change', 'action_status_update')),
	CONSTRAINT "proposals_status" CHECK ("proposals"."status" in ('pending', 'approved', 'rejected', 'conflicted'))
);
--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "proposals_user_status_idx" ON "proposals" USING btree ("user_id","status");