# Sub-project 15 (part 1): Roles, share by link, comments — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** roles with seat limits and invite links (15.2), share a read-only copy by link (15.1), comments on boards with in-app notifications (15.4).

**Spec:** `docs/superpowers/specs/2026-10-06-sp15-roles-share-comments-design.md` (acceptance criteria: `docs/roadmap/sp15-collaboration.md`).

**Tech stack:** Next.js 16 (read `apps/web/node_modules/next/dist/docs/` before touching Next APIs), React 19, Drizzle + Postgres, Vitest.

## Global constraints

- Billing is Razorpay only. SP13 and SP14 are dropped.
- No document `schemaVersion` bump; no command changes.
- **One migration, `0014_*`**, generated with `pnpm --filter @chitrapx/db generate`, renamed into the 0014 slot, then hand-edited (enum conversion, RLS). It is **not** run against the shared database. Tests that need it run against a throwaway container:

  ```bash
  docker run -d --name sp15-pg -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55415:5432 public.ecr.aws/supabase/postgres:17.11.0.002
  # container only: make auth.uid() read request.jwt.claims (as the SP16 agent did)
  docker exec sp15-pg psql -U supabase_admin -d postgres -c "create or replace function auth.uid() returns uuid language sql stable as \$\$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid \$\$;"
  (cd packages/db && DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55415/postgres npx drizzle-kit migrate)
  DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55415/postgres pnpm --filter @chitrapx/web exec vitest run test/members.test.ts
  docker rm -f sp15-pg   # when done
  ```

- DB tests run with `--testTimeout=90000 --hookTimeout=90000`.
- No dev server, MinIO or e2e runs. E2E specs are written, not run.
- Not touched (15.3 owns them): `editor/store.ts`, `editor/save.ts`, editor sync/presence, `saveDoc`. `Editor.tsx` gets only a `children` slot.

## Tasks

Each task: failing test → watch it fail → implement → pass → commit.

### Task 1: Schema, plans and migration 0014
- `schema.ts`: `member_role` = owner/admin/editor/viewer (default viewer); `MEMBER_ROLES`; tables `workspaceInvites`, `projectShares`, `projectComments`, `notifications`.
- `plans.ts`: `maxSeats` (free 1, pro 3, studio 10).
- Generate, move into `0014_sp15_collaboration.sql` (journal idx 14), replace drizzle's enum handling with the rename/convert/drop sequence (member → editor), add `memberships_one_owner`, `member_role_in`, RLS.
- Tests (local container): `packages/db/test/rls.test.ts` — the four new tables in the cross-workspace matrix; invites readable by owner/admin but not editor/viewer; notifications only by recipient; a user in two workspaces reads both and nothing of a third; anon reads no `project_shares`. `packages/db/test/memberRole.test.ts` — the conversion maps `member` to `editor` and keeps `owner` (runs the migration's conversion statements against a scratch copy of the old type and table); one owner per workspace is enforced. Plans test: seats present and increasing.

### Task 2: Roles on Ctx and the permission helper
- `server/authz.ts`: `ACTIONS`, `can`, `authorize`, `roleAtLeast`.
- `server/context.ts`: `Ctx.role`; `contextFor(user, cookieWs)` (DB only, testable), `requireContext(action = "view")`, `listWorkspaces(userId)`, `WS_COOKIE`.
- Tests: `test/authz.test.ts` (matrix of role × action; 403 message); `test/context.test.ts` (oldest by default, cookie picks, unknown cookie 403 `access_removed`, role carried, self-heal).
- Update every test and `render/[jobId]/page.tsx` that builds a `Ctx` by hand to include `role`.

### Task 3: Enforce on every write route
- Pass the action to `requireContext` in every mutating route (table in the spec). Community `[action]` route authorizes per action.
- `PUT /api/projects/:id/doc` → `edit` (no change to `saveDoc`).
- Tests: `test/routeGuards.test.ts` walks `src/app/api/**/route.ts` and fails on an unguarded mutating handler; `test/routesAuthz.test.ts` mocks the Supabase session and cookies and calls the real `PUT doc` handler as viewer (403), editor (200) and removed member (403), and a job route as viewer (403).

### Task 4: Members, invites, seats and workspace switching (server)
- `server/members.ts`: `listMembers`, `seatUsage`, `createInvite` (token, hash, seat check, re-invite revokes), `revokeInvite`, `inviteInfo`, `acceptInvite`, `changeRole` (transfer), `removeMember`, `leaveWorkspace`, `assertMember` for switching.
- Routes: `api/members` (GET), `api/members/[userId]` (PATCH, DELETE), `api/invites` (POST), `api/invites/[inviteId]` (DELETE), `api/invites/accept` (POST), `api/workspaces/switch` (POST), `api/me` (GET).
- Test: `test/members.test.ts` — editor invite accepted by the right email gives role editor and the link dies; second use 410; expired 410; wrong email 403; free plan second seat refused naming the plan; pro 4th refused; pending invites count; admin cannot change owner; sole owner cannot leave/be demoted/removed; transfer swaps roles; removal makes `contextFor` 403; downgrade keeps members and blocks invites; switching only to own memberships.

### Task 5: Team page, switcher, invite page, access watcher (UI)
- `app/dashboard/team/page.tsx` + `components/TeamPanel.tsx` (members, roles, invites, copy link once, over-limit banner, upgrade link).
- `components/WorkspaceSwitcher.tsx` in the dashboard header; `components/AccessRemoved.tsx` when `requireContext` throws `access_removed`.
- `app/invite/[token]/page.tsx` + `components/AcceptInvite.tsx`.
- `components/AccessWatcher.tsx` (polls `/api/me`), mounted on the editor page. Viewers get the read-only project view instead of the editor.
- Test: pure helpers (`test/teamModel.test.ts`: which roles an actor may assign to whom, seat banner text).

### Task 6: Share by link (server)
- `server/shares.ts`: `getShare`, `enableShare` (create/update/regenerate), `disableShare`, `resolveShare`, `sharedView`, `duplicateShared`; `lib/rateLimit.ts`.
- Community helper reused: `mapSources` exported from `server/community.ts`.
- Routes: `api/projects/[projectId]/share` (GET, PUT, DELETE), `api/shared/[slug]` (GET), `api/shared/[slug]/duplicate` (POST).
- Tests: `test/shares.test.ts` — anonymous view has boards and signed URLs only for the project's assets, no `workspace_id`/`updated_by`/emails; disabled → 404; regenerate kills old slug; expired → 404; duplicate copies the doc (asset ids re-pointed), its assets resolve in the new workspace, editing the copy leaves the original; free user with 3 projects gets `plan_limit`; `allow_duplicate` off → 403. `test/rateLimit.test.ts`.

### Task 7: Share UI
- `components/SharePanel.tsx` on the project page; `app/s/[slug]/page.tsx` (noindex, `ProjectBoards`, Duplicate button) + `components/DuplicateShared.tsx`.

### Task 8: Comments and notifications (server)
- `server/comments.ts`: `listComments` (threads, orphan flag, author names), `createComment`, `updateComment` (body/resolve), `deleteComment`; `server/notifications.ts`: `mentionHandles`, `listNotifications`, `markRead`.
- Routes: `api/projects/[projectId]/comments` (GET, POST), `api/projects/[projectId]/comments/[commentId]` (PATCH, DELETE), `api/notifications` (GET, POST).
- Tests: `test/comments.test.ts` — viewer comments; reply nests under root; resolve/reopen; author edit sets edited, non-author editor 403; admin deletes any; deleting the element or board flags orphaned; comments absent from the doc and the share view; outsider 404; mention and reply notifications, never the actor.

### Task 9: Comments UI
- `editor/ui/CommentsPanel.tsx` (toggle, poll 1.5 s, new thread on selection/board, reply, resolve, edit, delete, show resolved, orphaned group). `Editor.tsx` gets a `children` slot; the editor page passes the panel. The viewer page shows a board-picker version of the same panel.
- `components/NotificationsBell.tsx` in the dashboard header.
- Test: `test/commentsModel.test.ts` (pure grouping: by board, resolved filter, orphaned).

### Task 10: E2E specs (written, not run), docs
- `apps/web/test-e2e/collaboration.spec.ts`: invite → accept → viewer 403 on save; share link anonymous view → disable → 404; comment appears for another member.
- Roadmap status, PENDING follow-ups (apply 0014).
- Final: `pnpm typecheck`, `pnpm lint`, touched tests green.
