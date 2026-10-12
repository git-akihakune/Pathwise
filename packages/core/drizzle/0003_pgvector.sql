CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION immutable_array_to_string(arr text[], sep text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT array_to_string(arr, sep) $$;
