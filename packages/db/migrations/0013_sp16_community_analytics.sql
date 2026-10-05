CREATE TYPE "public"."community_status" AS ENUM('published', 'hidden', 'removed');--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"path" text DEFAULT '' NOT NULL,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid,
	"staff_id" uuid,
	"action" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_imports" (
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_imports_post_id_user_id_pk" PRIMARY KEY("post_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "community_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_project_id" uuid,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text NOT NULL,
	"platforms" text[] DEFAULT '{}'::text[] NOT NULL,
	"kind" "project_kind" NOT NULL,
	"doc" jsonb NOT NULL,
	"assets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "community_status" DEFAULT 'published' NOT NULL,
	"import_count" integer DEFAULT 0 NOT NULL,
	"license_accepted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"reporter_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_reports_post_reporter_uq" UNIQUE("post_id","reporter_id")
);
--> statement-breakpoint
ALTER TABLE "community_actions" ADD CONSTRAINT "community_actions_staff_id_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_imports" ADD CONSTRAINT "community_imports_post_id_community_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."community_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_imports" ADD CONSTRAINT "community_imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_reports" ADD CONSTRAINT "community_reports_post_id_community_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."community_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_reports" ADD CONSTRAINT "community_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytics_events_name_created_idx" ON "analytics_events" USING btree ("name","created_at");--> statement-breakpoint
CREATE INDEX "community_actions_post_idx" ON "community_actions" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "community_posts_feed_idx" ON "community_posts" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "community_posts_author_idx" ON "community_posts" USING btree ("author_id","created_at");--> statement-breakpoint
CREATE INDEX "community_reports_reporter_idx" ON "community_reports" USING btree ("reporter_id","created_at");--> statement-breakpoint
-- RLS (SP16). Every write goes through the server role; users only read, and only what they may see.
alter table community_posts enable row level security;
--> statement-breakpoint
alter table community_reports enable row level security;
--> statement-breakpoint
alter table community_imports enable row level security;
--> statement-breakpoint
alter table community_actions enable row level security;
--> statement-breakpoint
alter table analytics_events enable row level security;
--> statement-breakpoint
-- Hidden and removed posts are invisible to everyone but their author (staff read through the server).
create policy community_posts_read on community_posts for select to authenticated using (status = 'published' or author_id = auth.uid());
--> statement-breakpoint
create policy community_reports_read_own on community_reports for select to authenticated using (reporter_id = auth.uid());
--> statement-breakpoint
-- community_actions (audit log) and analytics_events get no policies, so no user can read or write them.
create policy community_imports_read_own on community_imports for select to authenticated using (user_id = auth.uid());
