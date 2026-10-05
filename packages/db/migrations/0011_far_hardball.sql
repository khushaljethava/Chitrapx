ALTER TYPE "public"."asset_kind" ADD VALUE 'reference';--> statement-breakpoint
CREATE TABLE "reference_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"insight" jsonb NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reference_insights_asset_id_unique" UNIQUE("asset_id")
);
--> statement-breakpoint
ALTER TABLE "reference_insights" ADD CONSTRAINT "reference_insights_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_insights" ADD CONSTRAINT "reference_insights_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
alter table reference_insights enable row level security;
--> statement-breakpoint
create policy reference_insights_read on reference_insights for select to authenticated using (is_member(workspace_id));
