ALTER TABLE "project_versions" ADD COLUMN "kind" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
CREATE INDEX "project_versions_project_created_idx" ON "project_versions" USING btree ("project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
UPDATE "project_versions" SET "kind" = 'export' WHERE "label" = 'export';
