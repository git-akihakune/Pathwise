CREATE TABLE "llm_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"provider_config_id" uuid,
	"model" text NOT NULL,
	"role" text NOT NULL,
	"purpose" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_usage_role" CHECK ("llm_usage"."role" in ('main','fast','embedding'))
);
--> statement-breakpoint
CREATE TABLE "provider_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"base_url" text,
	"encrypted_key" text,
	"key_last4" text,
	"models" jsonb NOT NULL,
	"context_window" integer,
	"capabilities" jsonb,
	"status" text DEFAULT 'untested' NOT NULL,
	"auth_failed" boolean DEFAULT false NOT NULL,
	"last_tested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_configs_kind" CHECK ("provider_configs"."kind" in ('anthropic','openai','google','openai_compatible')),
	CONSTRAINT "provider_configs_status" CHECK ("provider_configs"."status" in ('untested','full','degraded','unsupported'))
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"provider_config_id" uuid,
	"bluntness" smallint DEFAULT 3 NOT NULL,
	"timezone" text,
	"checkin_enabled" boolean DEFAULT true NOT NULL,
	"checkin_day" smallint DEFAULT 0 NOT NULL,
	"checkin_time" text DEFAULT '18:00' NOT NULL,
	"email_enabled" boolean DEFAULT true NOT NULL,
	"profile_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_settings_bluntness" CHECK ("user_settings"."bluntness" between 1 and 5),
	CONSTRAINT "user_settings_checkin_day" CHECK ("user_settings"."checkin_day" between 0 and 6)
);
--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "instance_provider_config_id" uuid;--> statement-breakpoint
ALTER TABLE "llm_usage" ADD CONSTRAINT "llm_usage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_usage" ADD CONSTRAINT "llm_usage_provider_config_id_provider_configs_id_fk" FOREIGN KEY ("provider_config_id") REFERENCES "public"."provider_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_configs" ADD CONSTRAINT "provider_configs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_provider_config_id_provider_configs_id_fk" FOREIGN KEY ("provider_config_id") REFERENCES "public"."provider_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "llm_usage_user_created_idx" ON "llm_usage" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "llm_usage_created_idx" ON "llm_usage" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "provider_configs_user_id_idx" ON "provider_configs" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "instance_settings" ADD CONSTRAINT "instance_settings_instance_provider_config_id_provider_configs_id_fk" FOREIGN KEY ("instance_provider_config_id") REFERENCES "public"."provider_configs"("id") ON DELETE set null ON UPDATE no action;