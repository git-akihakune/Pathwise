CREATE TABLE "actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"plan_id" uuid NOT NULL,
	"milestone_id" uuid,
	"title" text NOT NULL,
	"notes" text,
	"week_of" date NOT NULL,
	"status" text DEFAULT 'todo' NOT NULL,
	"done_at" timestamp with time zone,
	CONSTRAINT "actions_week_of_monday" CHECK (extract(isodow from "actions"."week_of") = 1),
	CONSTRAINT "actions_status" CHECK ("actions"."status" in ('todo','done','skipped'))
);
--> statement-breakpoint
CREATE TABLE "career_paths" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"title" text NOT NULL,
	"occupation_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"rationale" text NOT NULL,
	"route" jsonb NOT NULL,
	"skill_gaps" jsonb NOT NULL,
	"feasibility" jsonb NOT NULL,
	"status" text DEFAULT 'explored' NOT NULL,
	CONSTRAINT "career_paths_status" CHECK ("career_paths"."status" in ('explored','chosen','dismissed'))
);
--> statement-breakpoint
CREATE TABLE "milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"plan_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"target_date" date,
	"position" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	CONSTRAINT "milestones_status" CHECK ("milestones"."status" in ('open','done','dropped'))
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"north_star" text NOT NULL,
	"career_path_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	CONSTRAINT "plans_status" CHECK ("plans"."status" in ('active','archived'))
);
--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_paths" ADD CONSTRAINT "career_paths_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_career_path_id_career_paths_id_fk" FOREIGN KEY ("career_path_id") REFERENCES "public"."career_paths"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "actions_user_week_idx" ON "actions" USING btree ("user_id","week_of");--> statement-breakpoint
CREATE INDEX "actions_plan_id_idx" ON "actions" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "career_paths_user_id_idx" ON "career_paths" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "milestones_plan_id_idx" ON "milestones" USING btree ("plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_one_active" ON "plans" USING btree ("user_id") WHERE status = 'active';