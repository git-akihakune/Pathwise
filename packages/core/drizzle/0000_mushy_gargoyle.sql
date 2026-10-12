CREATE TABLE "instance_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"signup_mode" text DEFAULT 'invite_only' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instance_settings_singleton" CHECK ("instance_settings"."id" = 1),
	CONSTRAINT "instance_settings_signup_mode" CHECK ("instance_settings"."signup_mode" in ('open','invite_only','closed'))
);
