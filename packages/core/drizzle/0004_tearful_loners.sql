CREATE TABLE "occupation_relations" (
	"from_id" text NOT NULL,
	"to_id" text NOT NULL,
	"kind" text NOT NULL,
	CONSTRAINT "occupation_relations_from_id_to_id_kind_pk" PRIMARY KEY("from_id","to_id","kind"),
	CONSTRAINT "occupation_relations_kind" CHECK ("occupation_relations"."kind" in ('related','crosswalk'))
);
--> statement-breakpoint
CREATE TABLE "occupation_skills" (
	"occupation_id" text NOT NULL,
	"taxonomy_skill_id" text NOT NULL,
	"importance" double precision NOT NULL,
	"level" double precision,
	CONSTRAINT "occupation_skills_occupation_id_taxonomy_skill_id_pk" PRIMARY KEY("occupation_id","taxonomy_skill_id"),
	CONSTRAINT "occupation_skills_importance" CHECK ("occupation_skills"."importance" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "occupations" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"alt_titles" text[] DEFAULT '{}' NOT NULL,
	"tasks" text[] DEFAULT '{}' NOT NULL,
	"embedding" vector,
	"embedding_model" text,
	"search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', "title"), 'A') || setweight(to_tsvector('english', immutable_array_to_string("alt_titles", ' ')), 'B') || setweight(to_tsvector('english', "description"), 'C')) STORED,
	CONSTRAINT "occupations_source_code_unique" UNIQUE("source","code"),
	CONSTRAINT "occupations_source" CHECK ("occupations"."source" in ('onet','esco'))
);
--> statement-breakpoint
CREATE TABLE "taxonomy_meta" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"version" text NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "taxonomy_meta_singleton" CHECK ("taxonomy_meta"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "taxonomy_skills" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', "name"), 'A') || setweight(to_tsvector('english', "description"), 'B')) STORED,
	CONSTRAINT "taxonomy_skills_source_code_unique" UNIQUE("source","code"),
	CONSTRAINT "taxonomy_skills_source" CHECK ("taxonomy_skills"."source" in ('onet','esco'))
);
--> statement-breakpoint
ALTER TABLE "occupation_relations" ADD CONSTRAINT "occupation_relations_from_id_occupations_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."occupations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occupation_relations" ADD CONSTRAINT "occupation_relations_to_id_occupations_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."occupations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occupation_skills" ADD CONSTRAINT "occupation_skills_occupation_id_occupations_id_fk" FOREIGN KEY ("occupation_id") REFERENCES "public"."occupations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occupation_skills" ADD CONSTRAINT "occupation_skills_taxonomy_skill_id_taxonomy_skills_id_fk" FOREIGN KEY ("taxonomy_skill_id") REFERENCES "public"."taxonomy_skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "occupation_skills_skill_idx" ON "occupation_skills" USING btree ("taxonomy_skill_id");--> statement-breakpoint
CREATE INDEX "occupations_search_idx" ON "occupations" USING gin ("search");--> statement-breakpoint
CREATE INDEX "taxonomy_skills_search_idx" ON "taxonomy_skills" USING gin ("search");--> statement-breakpoint
CREATE INDEX "taxonomy_skills_lower_name_idx" ON "taxonomy_skills" USING btree (lower("name"));