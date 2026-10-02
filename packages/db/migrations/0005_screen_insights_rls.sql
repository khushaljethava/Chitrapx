alter table screen_insights enable row level security;
--> statement-breakpoint
create policy screen_insights_read on screen_insights for select to authenticated using (is_member(workspace_id));
