CREATE TABLE "stories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"source_type" text DEFAULT 'manual' NOT NULL,
	"source_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"title" text NOT NULL,
	"situation" text DEFAULT '' NOT NULL,
	"task" text DEFAULT '' NOT NULL,
	"action" text DEFAULT '' NOT NULL,
	"result" text DEFAULT '' NOT NULL,
	"metrics" text,
	"skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"embedding" vector,
	"embedding_model" text,
	"search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', "title" || ' ' || immutable_array_to_string("skills", ' ')), 'A') || setweight(to_tsvector('english', "situation" || ' ' || "task" || ' ' || "action" || ' ' || "result" || ' ' || coalesce("metrics", '')), 'B')) STORED,
	CONSTRAINT "stories_source_type" CHECK ("source_type" in ('cv','linkedin','message','checkin','manual'))
);
--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stories_user_id_idx" ON "stories" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "stories_search_idx" ON "stories" USING gin ("search");