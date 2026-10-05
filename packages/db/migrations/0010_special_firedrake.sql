ALTER TABLE "apps" ADD COLUMN "brief" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "glossary" text[] DEFAULT '{}'::text[] NOT NULL;