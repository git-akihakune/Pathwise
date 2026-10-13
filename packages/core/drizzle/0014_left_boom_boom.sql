CREATE TABLE "checkins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"week_of" date NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"workflow_run_id" uuid,
	"energy" smallint,
	"summary" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"sent_at" timestamp with time zone,
	"nudged_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkins_energy" CHECK ("checkins"."energy" between 1 and 5),
	CONSTRAINT "checkins_status" CHECK ("checkins"."status" in ('scheduled', 'sent', 'nudged', 'completed', 'missed'))
);
--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "checkin_ics_sequence" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "checkins_user_week" ON "checkins" USING btree ("user_id","week_of");--> statement-breakpoint
CREATE INDEX "checkins_user_due_idx" ON "checkins" USING btree ("user_id","due_at");