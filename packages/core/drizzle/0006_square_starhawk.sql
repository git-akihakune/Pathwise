CREATE TABLE "memory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"source_type" text DEFAULT 'manual' NOT NULL,
	"source_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"category" text NOT NULL,
	"content" text NOT NULL,
	"confidence" double precision DEFAULT 1 NOT NULL,
	"sensitive" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"supersedes_id" uuid,
	"embedding" vector,
	"embedding_model" text,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', "content")) STORED,
	CONSTRAINT "memory_items_source_type" CHECK ("source_type" in ('cv','linkedin','message','checkin','manual')),
	CONSTRAINT "memory_items_category" CHECK ("memory_items"."category" in ('value','constraint','aspiration','energizer','drain','preference','fact','event','observation')),
	CONSTRAINT "memory_items_confidence" CHECK ("memory_items"."confidence" >= 0 and "memory_items"."confidence" <= 1),
	CONSTRAINT "memory_items_status" CHECK ("memory_items"."status" in ('active','pending','rejected','superseded'))
);
--> statement-breakpoint
ALTER TABLE "memory_items" ADD CONSTRAINT "memory_items_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_items" ADD CONSTRAINT "memory_items_supersedes_id_memory_items_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."memory_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memory_items_user_status_idx" ON "memory_items" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "memory_items_search_idx" ON "memory_items" USING gin ("search");