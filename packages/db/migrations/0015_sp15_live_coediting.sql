CREATE TABLE "project_commands" (
	"project_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"client_seq" integer NOT NULL,
	"user_id" uuid,
	"command" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_commands_project_id_seq_pk" PRIMARY KEY("project_id","seq"),
	CONSTRAINT "project_commands_client_uq" UNIQUE("project_id","client_id","client_seq")
);
--> statement-breakpoint
ALTER TABLE "project_commands" ADD CONSTRAINT "project_commands_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_commands" ADD CONSTRAINT "project_commands_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_commands" ADD CONSTRAINT "project_commands_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- RLS (SP15). Members read their workspace's command log; every write goes through the server role.
alter table project_commands enable row level security;
--> statement-breakpoint
create policy project_commands_read on project_commands for select to authenticated using (is_member(workspace_id));
--> statement-breakpoint
-- Realtime channel authorisation: `project:<uuid>` (document events, sent only by the server with the
-- service role) and `project-live:<uuid>` (presence, cursors, drag previews between members).
create or replace function public.can_use_project_topic(topic text) returns boolean
  language sql stable security definer set search_path = public
as $$
  select case
    when topic ~ '^project(-live)?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then exists (select 1 from projects p where p.id = split_part(topic, ':', 2)::uuid and is_member(p.workspace_id))
    else false
  end
$$;
--> statement-breakpoint
revoke all on function public.can_use_project_topic(text) from public, anon;
--> statement-breakpoint
grant execute on function public.can_use_project_topic(text) to authenticated;
--> statement-breakpoint
-- Only where Supabase Realtime is installed (a plain Postgres has no realtime schema). Members may receive on
-- both topics and send (broadcast, presence) only on project-live:<uuid>. No insert policy covers project:<uuid>,
-- so no client can publish document events there; the server sends them with the service role after commit.
do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute $p$
      create policy chitrapx_project_topics_read on realtime.messages for select to authenticated
      using (realtime.messages.extension in ('broadcast', 'presence') and public.can_use_project_topic((select realtime.topic())))
    $p$;
    execute $p$
      create policy chitrapx_project_live_send on realtime.messages for insert to authenticated
      with check (
        realtime.messages.extension in ('broadcast', 'presence')
        and (select realtime.topic()) like 'project-live:%'
        and public.can_use_project_topic((select realtime.topic()))
      )
    $p$;
  end if;
end
$$;