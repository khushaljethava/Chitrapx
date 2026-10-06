-- SP15: roles (owner, admin, editor, viewer), invites, share links, comments and in-app notifications.
-- Postgres cannot drop an enum value, so member_role is swapped for a new type. Existing 'member' rows
-- become 'editor' (the same powers they had); owners stay owners. The default becomes the least privilege.
-- Names are unqualified on purpose: packages/db/test/memberRole.test.ts runs this block in a scratch schema.
-- sp15:role-conversion:begin
ALTER TYPE member_role RENAME TO member_role_old;
--> statement-breakpoint
CREATE TYPE member_role AS ENUM('owner', 'admin', 'editor', 'viewer');
--> statement-breakpoint
ALTER TABLE memberships ALTER COLUMN role DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE memberships ALTER COLUMN role SET DATA TYPE member_role USING (CASE role::text WHEN 'member' THEN 'editor' ELSE role::text END)::member_role;
--> statement-breakpoint
ALTER TABLE memberships ALTER COLUMN role SET DEFAULT 'viewer';
--> statement-breakpoint
DROP TYPE member_role_old;
-- sp15:role-conversion:end
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"actor_id" uuid,
	"kind" text NOT NULL,
	"project_id" uuid NOT NULL,
	"comment_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "project_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"board_id" text NOT NULL,
	"element_id" text,
	"parent_id" uuid,
	"x_pct" real,
	"y_pct" real,
	"body" text NOT NULL,
	"author_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid
);
--> statement-breakpoint
CREATE TABLE "project_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"allow_duplicate" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "project_shares_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "workspace_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "member_role" NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_comment_id_project_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."project_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_comments" ADD CONSTRAINT "project_comments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_comments" ADD CONSTRAINT "project_comments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_comments" ADD CONSTRAINT "project_comments_parent_id_project_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."project_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_comments" ADD CONSTRAINT "project_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_comments" ADD CONSTRAINT "project_comments_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_shares" ADD CONSTRAINT "project_shares_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_shares" ADD CONSTRAINT "project_shares_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_shares" ADD CONSTRAINT "project_shares_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "project_comments_project_board_idx" ON "project_comments" USING btree ("project_id","board_id");--> statement-breakpoint
CREATE INDEX "project_comments_parent_idx" ON "project_comments" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_shares_active_uq" ON "project_shares" USING btree ("project_id") WHERE revoked_at is null;--> statement-breakpoint
CREATE INDEX "workspace_invites_workspace_idx" ON "workspace_invites" USING btree ("workspace_id");--> statement-breakpoint
-- Defensive: a workspace with several owners (none expected; ensureWorkspace makes one) keeps its oldest, the rest become admins.
UPDATE memberships m SET role = 'admin' WHERE m.role = 'owner' AND EXISTS (
  SELECT 1 FROM memberships o WHERE o.workspace_id = m.workspace_id AND o.role = 'owner' AND (o.created_at, o.user_id) < (m.created_at, m.user_id));--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_one_owner" ON "memberships" USING btree ("workspace_id") WHERE role = 'owner';
--> statement-breakpoint
-- RLS (SP15). Users only read; every write goes through the server role (see 0002_lock_down_writes.sql).
create or replace function public.member_role_in(ws uuid) returns public.member_role
  language sql stable security definer set search_path = public
as $$ select role from memberships where workspace_id = ws and user_id = auth.uid() $$;
--> statement-breakpoint
revoke all on function public.member_role_in(uuid) from public, anon;
--> statement-breakpoint
grant execute on function public.member_role_in(uuid) to authenticated;
--> statement-breakpoint
alter table workspace_invites enable row level security;
--> statement-breakpoint
alter table project_shares enable row level security;
--> statement-breakpoint
alter table project_comments enable row level security;
--> statement-breakpoint
alter table notifications enable row level security;
--> statement-breakpoint
-- Invite rows (email, role, hashed token) are for the people who manage members.
create policy workspace_invites_read on workspace_invites for select to authenticated using (member_role_in(workspace_id) in ('owner', 'admin'));
--> statement-breakpoint
-- Members see their projects' links; the public preview resolves slugs on the server, never through anon.
create policy project_shares_read on project_shares for select to authenticated using (is_member(workspace_id));
--> statement-breakpoint
create policy project_comments_read on project_comments for select to authenticated using (is_member(workspace_id));
--> statement-breakpoint
create policy notifications_read_own on notifications for select to authenticated using (user_id = auth.uid());
