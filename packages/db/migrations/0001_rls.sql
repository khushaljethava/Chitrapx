-- Workspace isolation. The server connects as a privileged role and bypasses RLS;
-- these policies protect every path that uses a user's JWT (Supabase client, PostgREST).
create or replace function public.is_member(ws uuid) returns boolean
  language sql stable security definer set search_path = public
as $$ select exists (select 1 from memberships where workspace_id = ws and user_id = auth.uid()) $$;
--> statement-breakpoint
revoke all on function public.is_member(uuid) from public, anon;
--> statement-breakpoint
grant execute on function public.is_member(uuid) to authenticated;
--> statement-breakpoint
alter table profiles enable row level security;
--> statement-breakpoint
alter table workspaces enable row level security;
--> statement-breakpoint
alter table memberships enable row level security;
--> statement-breakpoint
alter table apps enable row level security;
--> statement-breakpoint
alter table projects enable row level security;
--> statement-breakpoint
alter table project_versions enable row level security;
--> statement-breakpoint
alter table assets enable row level security;
--> statement-breakpoint
alter table jobs enable row level security;
--> statement-breakpoint
alter table credit_ledger enable row level security;
--> statement-breakpoint
alter table templates enable row level security;
--> statement-breakpoint
create policy profiles_own on profiles for all to authenticated using (id = auth.uid()) with check (id = auth.uid());
--> statement-breakpoint
create policy workspaces_read on workspaces for select to authenticated using (is_member(id));
--> statement-breakpoint
create policy workspaces_update on workspaces for update to authenticated using (is_member(id)) with check (is_member(id));
--> statement-breakpoint
create policy memberships_read on memberships for select to authenticated using (is_member(workspace_id));
--> statement-breakpoint
create policy apps_member on apps for all to authenticated using (is_member(workspace_id)) with check (is_member(workspace_id));
--> statement-breakpoint
create policy projects_member on projects for all to authenticated using (is_member(workspace_id)) with check (is_member(workspace_id));
--> statement-breakpoint
create policy project_versions_member on project_versions for all to authenticated using (is_member(workspace_id)) with check (is_member(workspace_id));
--> statement-breakpoint
create policy assets_member on assets for all to authenticated using (is_member(workspace_id)) with check (is_member(workspace_id));
--> statement-breakpoint
create policy jobs_read on jobs for select to authenticated using (is_member(workspace_id));
--> statement-breakpoint
create policy credit_ledger_read on credit_ledger for select to authenticated using (is_member(workspace_id));
--> statement-breakpoint
create policy templates_read on templates for select to authenticated using (true);
