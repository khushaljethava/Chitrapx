-- Users hold a JWT and can reach PostgREST directly, so RLS must not allow any write the
-- server would refuse (plan changes, plan limits, unvalidated assets). Every write goes
-- through the server, which connects as a privileged role; users only read.
drop policy workspaces_update on workspaces;
--> statement-breakpoint
drop policy apps_member on apps;
--> statement-breakpoint
drop policy projects_member on projects;
--> statement-breakpoint
drop policy project_versions_member on project_versions;
--> statement-breakpoint
drop policy assets_member on assets;
--> statement-breakpoint
drop policy profiles_own on profiles;
--> statement-breakpoint
create policy apps_read on apps for select to authenticated using (is_member(workspace_id));
--> statement-breakpoint
create policy projects_read on projects for select to authenticated using (is_member(workspace_id));
--> statement-breakpoint
create policy project_versions_read on project_versions for select to authenticated using (is_member(workspace_id));
--> statement-breakpoint
create policy assets_read on assets for select to authenticated using (is_member(workspace_id));
--> statement-breakpoint
create policy profiles_read on profiles for select to authenticated using (id = auth.uid());
--> statement-breakpoint
-- A job can end exactly once: settled or refunded, never both.
create unique index credit_ledger_job_final_uq on credit_ledger (job_id) where reason in ('settle', 'refund');
