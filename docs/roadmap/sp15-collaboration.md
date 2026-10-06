# SP15: Collaboration

**Status:** 15.1, 15.2 and 15.4 built (spec `docs/superpowers/specs/2026-10-06-sp15-roles-share-comments-design.md`); 15.3 on a separate branch
**Goal:** Users can share a project by link, invite teammates with roles that respect plan seat limits, edit the same project live with presence and cursors, and leave comments on boards.
**Depends on:** SP9 (version restore, and a stable command model: live sync and comment anchors both depend on `Command` and the doc schema not churning; restore must also be safe when other people are connected).
**Gap source:** open-screenshot-generator (MIT) has live editing, share-by-link and project versions. None of the other five repos has collaboration: a search of PixelDeck, launch, app-store-screenshots, appshots and storeshots for collab, invite, yjs and presence found nothing relevant. Comments and roles have no reference code; they are Chitrapx-original.

Note on the competitor architecture: open-screenshot-generator does live editing peer-to-peer (Yjs over y-webrtc, end-to-end encrypted, key in the URL fragment, a tiny signalling relay that never sees the document). That fits a local-first app with no authoritative server doc. Chitrapx has an authoritative Postgres doc with a `revision` column, workspace RLS and billing, so the design choice is different (see "Sync approach options").

## What Chitrapx has today

- `workspaces` (with `plan`: free/pro/studio) and `memberships (workspace_id, user_id, role)` with `member_role` enum `owner | member`: `packages/db/src/schema.ts:9`, `:48`, `:57`. Only `ensureWorkspace` in `packages/db/src/onboarding.ts:26` inserts memberships (always `owner`, one workspace per user).
- `requireContext()` in `apps/web/src/server/context.ts` picks the user's oldest membership and returns `{ userId, workspaceId, plan }`. The comment says "v1: a user has exactly one workspace". Multi-workspace users and roles are not represented in `Ctx`.
- RLS: `is_member(ws)` security-definer helper in `packages/db/migrations/0001_rls.sql:3`. `0002_lock_down_writes.sql` dropped all write policies; users only get select (`apps_read`, `projects_read`, `project_versions_read`, ...). All writes go through the server, which connects as a privileged role. RLS tests in `packages/db/test/rls.test.ts`.
- Plan limits: `PLANS` in `packages/db/src/plans.ts` has `monthlyCredits`, `maxApps`, `maxProjects`. No seat limit.
- Editor: every change is a pure `Command` (union in `apps/web/src/editor/commands.ts:9`, applied by `applyCommand` at `:46`) dispatched through the Zustand store (`apps/web/src/editor/store.ts`, which holds `revision` and `replaceDoc`). Elements are addressed by stable `Ref { groupId, boardId, elementId }` (`commands.ts:7`).
- Save: `useAutosave` in `apps/web/src/editor/save.ts` PUTs the whole doc with `revision`; `saveDoc` in `apps/web/src/server/projects.ts:132` does an optimistic `UPDATE ... WHERE revision = $n` and throws `ConflictError` (HTTP 409) otherwise; the client shows the conflict dialog (`save.ts:89`, status `"conflict"`). Every 20th revision (`AUTO_SNAPSHOT_EVERY`) is written to `project_versions`.
- Supabase client helpers exist (`apps/web/src/lib/supabase/browser.ts`, `server.ts`, `admin.ts`); Realtime is not used anywhere yet.
- Billing is Razorpay (`apps/web/src/server/billing.ts`, `workspaces.razorpay_customer_id`).

## Features

### 15.1 Share a copy by link

- **What it does:** A project owner or editor creates a link. Anyone with the link sees a read-only preview of the project (boards rendered, no editing, no private asset URLs leaked). A signed-in viewer can click "Duplicate into my workspace" to get an independent copy.
- **Details:**
  - Link = unguessable slug (at least 128 bits, random), stored per project; one active link per project; "regenerate" mints a new slug and kills the old one (competitor does the same: a new slug on every enable).
  - Disabling the link makes the slug return 404 immediately.
  - Preview is a snapshot read of the current server doc plus signed asset URLs scoped to that project's assets only; never expose `workspace_id`, owner email or other projects.
  - Preview renders with the existing renderer (read-only viewer of boards); locale switcher allowed if the doc has locales.
  - Duplicate: requires sign-in; clones `doc` with all asset references re-pointed to copies in the viewer's workspace (reuse the asset copy path used by import/template code); counts toward `maxProjects`, so a free user at the limit gets the upgrade prompt, not a silent failure; the copy gets `revision = 0`, a name suffix, no link and no comments.
  - Optional expiry date and optional "allow duplicate" toggle (default on).
  - Rate-limit the public endpoint; add `noindex`.
- **Acceptance criteria:**
  - An anonymous browser opens `/s/<slug>` and sees the boards; there is no editing UI and `PUT /api/projects/:id/doc` with no session still returns 401.
  - After "disable link" the same URL returns 404 within one request.
  - After "regenerate" the old URL 404s and the new one works.
  - Duplicate by a signed-in user creates a project in their workspace whose assets load and whose doc equals the source at the time of copy; editing the copy does not change the original.
  - A free-plan user with 3 projects gets a plan-limit error on duplicate.
  - The preview response contains no `workspace_id`, no `updated_by`, and no URLs for assets outside the project.
  - RLS test: a user in workspace B cannot select workspace A's `project_shares` rows.
- **Chitrapx today:** nothing. Projects are only readable by workspace members (`projects_read`). There is no public route; the only public-ish route group is `apps/web/src/app/render`, which is for the render worker.
- **Chitrapx changes:**
  - DB: new `project_shares` table (`id`, `workspace_id`, `project_id`, `slug` unique, `allow_duplicate`, `expires_at`, `created_by`, `created_at`, `revoked_at`); migration `0009_*.sql` with RLS (members read; writes server only, matching `0002_lock_down_writes.sql`). Add to `packages/db/src/schema.ts`.
  - API: `apps/web/src/app/api/projects/[projectId]/share/route.ts` (PUT enable/regenerate, DELETE disable); public `apps/web/src/app/api/shared/[slug]/route.ts` and `.../doc/route.ts`, `.../duplicate/route.ts` (auth).
  - Server: `apps/web/src/server/shares.ts` (slug generation, resolve slug to project via privileged DB, asset URL signing via `storage.ts`, duplicate via `projects.ts`).
  - UI: share popover in `apps/web/src/editor/ui` (find the existing top bar); public page `apps/web/src/app/s/[slug]/page.tsx` using a read-only editor canvas.
- **Reference code:**
  - `open-screenshot-generator/infra/vps/pb-hooks/060_projects.pb.js` (MIT) — routes `PUT /projects/{id}/share` (mints a new slug each time it is turned on, clears on off), `GET /shared/{slug}`, `/shared/{slug}/doc`, `/shared/{slug}/assets/{assetId}`; its header comment documents what the public endpoint must never return (no `shareSlug`, no owner info). Copy the leak rules, not the PocketBase code.
  - `open-screenshot-generator/src/lib/cloud/links.ts` (MIT) — how a share URL is built and parsed on the client.
  - `open-screenshot-generator/src/lib/cloud/api.ts` (MIT) — client calls `getShared`, `fetchSharedAsset`, used to load a shared project and its blobs.
- **License note:** MIT, code reusable with attribution in `NOTICES.md`; in practice only the endpoint list and leak rules transfer because the backend is PocketBase JS.
- **Size:** M

### 15.2 Team invites and roles (owner, admin, editor, viewer) with seat limits

- **What it does:** A workspace owner or admin invites people by email. Each member has a role that controls what they can do, and the plan caps the number of seats; adding past the cap prompts an upgrade (Razorpay).
- **Details:**
  - Roles. owner: everything including billing, delete workspace, transfer ownership; exactly one owner per workspace (v1). admin: manage members (except owner), manage apps and projects, no billing. editor: create and edit apps/projects, run jobs that spend credits, comment. viewer: read everything, comment, cannot edit or spend credits.
  - Invite flow: owner/admin enters email + role; server creates a `workspace_invites` row with a hashed single-use token, expiry 7 days; sends an email (no email provider was found in `apps/web/src/server`, so this needs a decision); invitee opens `/invite/<token>`, signs in or signs up, then accepts. Accept inserts the membership. The invite must match the signed-in email (or allow any email via link, see open questions).
  - Seat limit per plan, counted as members plus pending invites. Proposed starting values, business-tunable in `PLANS`: free 1, pro 3, studio 10 (extra seats via Razorpay add-on is an open question).
  - Changing a role, removing a member and leaving a workspace; the last owner cannot leave or be demoted. Removal is immediate: the removed user's next request gets 403 and Realtime channels are dropped.
  - Credits and billing stay per workspace; viewers cannot start jobs (server check, not UI only).
  - Because users can belong to several workspaces after this, `requireContext()` needs a "current workspace" (cookie or path), not "oldest membership".
- **Acceptance criteria:**
  - Owner invites `a@x.com` as editor; invite email contains a link; opening it while signed in as `a@x.com` creates a membership with role `editor` and the invite becomes unusable.
  - A second use of the same link fails; an expired link fails with a clear message.
  - On the free plan (1 seat) inviting a second person returns a plan-limit error naming the plan; on pro the 4th is refused.
  - A viewer calling `PUT /api/projects/:id/doc` or a job-creating route gets 403; an editor gets 200; an admin cannot change the owner's role.
  - Removing a member makes their next API call return 403 and their open editor shows an "access removed" state.
  - Demoting or removing the sole owner is rejected.
  - A user in two workspaces can switch between them and never sees the other's data (extend `packages/db/test/rls.test.ts`).
  - Downgrading a plan below the current member count does not delete members; it blocks new invites and shows an over-limit banner.
- **Chitrapx today:** `member_role` is `owner | member` (`packages/db/src/schema.ts:9`); `memberships.role` defaults `owner`; `is_member()` ignores role; `Ctx` has no role; no invite table; `PLANS` has no seat limit; one workspace per user is assumed in `requireContext` and `ensureWorkspace`.
- **Chitrapx changes:**
  - Migration `0010_*.sql`: new enum `owner | admin | editor | viewer` swapped onto `memberships.role` (Postgres cannot drop enum values, so create a new type and convert; map existing `member` rows to `editor`); `workspace_invites` table; `member_role_in(ws)` security-definer helper returning the caller's role for policies that need it; `is_member(ws)` unchanged.
  - `packages/db/src/plans.ts`: add `maxSeats` to `PlanLimits` and `PLANS`.
  - `packages/db/src/schema.ts`: enum, `workspaceInvites`.
  - `apps/web/src/server/context.ts`: add `role` to `Ctx`, add workspace selection; add `requireRole(ctx, "editor")` helper in `apps/web/src/server/http.ts` or a new `server/authz.ts`; apply it in `server/projects.ts`, `server/apps.ts`, `server/jobs.ts`, `server/uploads.ts`, `server/ai.ts`, `server/billing.ts` (billing: owner only).
  - New `apps/web/src/server/members.ts` and routes `apps/web/src/app/api/members/route.ts`, `.../invites/route.ts`, `apps/web/src/app/invite/[token]/page.tsx`; dashboard page `apps/web/src/app/dashboard/team/page.tsx`.
  - `apps/web/src/server/billing.ts`: if seat add-ons are chosen, a Razorpay add-on or subscription quantity (never Stripe).
  - Tests: `packages/db/test/rls.test.ts`, `onboarding.test.ts`, plus new role tests.
- **Reference code:**
  - `open-screenshot-generator/infra/vps/pb-migrations/1786000000_openscreengen_accounts.js` (MIT) — account model only; it has no team or role concept, so there is little to borrow. Listed so nobody searches for it again.
  - No invite, role or seat code exists in any of the six reference repos (searched src, workers, infra in open-screenshot-generator and the top level of the others).
- **License note:** Chitrapx-original. Nothing to copy; storeshots (AGPL-3.0, ideas only) and appshots (reference only) offer nothing here.
- **Size:** L

### 15.3 Live co-editing (presence, cursors, real-time command sync, conflict handling)

> **Built (2026-10-06, own branch; option C).** Spec `docs/superpowers/specs/2026-10-06-sp15-live-coediting-design.md`, plan and manual checks `docs/superpowers/plans/2026-10-06-sp15-live-coediting.md`. Migration `0015_sp15_live_coediting` is not applied yet (rechain after 0014).

- **What it does:** Two or more members open the same project and see each other's avatars, cursors and selections; edits appear for everyone within about a second without save conflicts.
- **Details:**
  - Presence: who is in the project, their colour, selected element/board, pointer position in board coordinates (throttle about 60 ms, as the competitor does); leaves after about 30 s of silence.
  - Real-time sync: a local `Command` is applied optimistically (existing behaviour), sent to the server, ordered, persisted and broadcast; peers apply the same command to their doc.
  - Conflict handling: commands address elements by stable `Ref` ids, so most concurrent commands commute. Cases that do not: delete vs update of the same element (update becomes a no-op, not an error), concurrent `moveBoard`/`reorderElement` (server order wins), same-property edits (last write by server order wins). A command that references a missing target is dropped on all clients, deterministically.
  - Undo/redo stays per user: undo emits an inverse command rather than rewinding the shared doc (today `past`/`future` in `store.ts` are local snapshots, which breaks once peers interleave edits; this is a required change).
  - The whole-doc autosave and the 409 dialog (`save.ts`) are replaced by command submission in collaborative mode; revision becomes the position in the command log. A single user offline keeps the old draft path (`idb.ts`) and rebases on reconnect.
  - Viewers get presence but cannot send commands. Removal of a member disconnects them.
  - Restore (SP9) in collaborative mode: restore is itself a command (`restoreVersion`) that replaces the doc and bumps a generation counter so peers reload.
  - Cap at about 10 concurrent editors per project.
- **Acceptance criteria:**
  - Two browsers on one project: moving an element in A moves it in B within 1 s; cursor and selection of A appear in B with A's colour and name.
  - Concurrent edits to different elements both survive on both clients and in the DB.
  - Concurrent edits to the same property converge to the same value on both clients and the DB.
  - A deleted element that the other client was dragging does not throw or resurrect it.
  - A client with 100 queued offline commands reconnects: commands are rebased or rejected with a clear error; no silent loss, no duplicate application (command ids are idempotent).
  - Undo in A reverts only A's last command; B's later edit survives.
  - Killing the Realtime connection shows "reconnecting"; no edits are lost; after reconnect the doc equals the server doc.
  - A viewer cannot publish a command (server rejects; Realtime authorization blocks broadcast).
  - The persisted doc after a session equals the fold of the command log (property test: random command interleavings converge, using `applyCommand` as the reducer).
- **Chitrapx today:** pure commands exist and apply to an Immer draft (`commands.ts:46`), which is the right base for a command log. Sync is whole-doc PUT with optimistic revision (`saveDoc`, `projects.ts:132`) and a 409 dialog; no websocket or Realtime usage; undo is snapshot based (`past`/`future` in `store.ts:106`). Commands carry client-generated ids for new entities (`newIds`, `newBoardId`), which helps determinism.
- **Chitrapx changes:** depends on the chosen approach, see next section. Under the recommended approach:
  - DB: `project_commands (project_id, seq bigint, command jsonb, client_id uuid, client_seq int, user_id, created_at, primary key (project_id, seq))` with a unique `(project_id, client_id, client_seq)` for idempotency; `projects.revision` becomes the head seq; a compaction step folds commands into `projects.doc` and writes `project_versions`.
  - API: `apps/web/src/app/api/projects/[projectId]/commands/route.ts` (POST batch, returns assigned seqs; GET `?after=seq` for catch-up); reuse `withTx` and the doc size limit from `server/projects.ts`; validate each command with zod and run `applyCommand` server side so the stored doc is always valid.
  - Client: new `apps/web/src/editor/sync.ts` (Realtime channel per project, outbox, rebase), changes to `store.ts` (dispatch returns the command to the outbox; inverse-command undo), `save.ts` (collab mode bypass), new `apps/web/src/editor/ui/Presence*.tsx` and a cursors overlay in the canvas component.
  - Realtime: Supabase Realtime Broadcast for command fan-out and Presence for cursors, on a private channel `project:<id>`, with an authorization policy on `realtime.messages` checking membership and role.
  - Move `applyCommand` and `Command` to a shared package (for example `packages/document`) if not already importable by server code, so server and client use one reducer.
- **Reference code:**
  - `open-screenshot-generator/src/lib/collab/ydoc.ts` (MIT) — how a board/element document maps to Yjs maps (`boardMap`, `boardOrder`, `writeArtboards`), the "touch only what differs" diffing, and tolerance for duplicate ids from concurrent inserts. Read for the list of conflict cases that bit them.
  - `open-screenshot-generator/src/lib/collab/session.ts` (MIT) — session lifecycle, awareness fields (`user`, cursor throttle `CURSOR_THROTTLE_MS = 60`), snapshot load on join, asset fetch, reconnect handling.
  - `open-screenshot-generator/src/lib/collab/types.ts` (MIT) — peer/presence shapes.
  - `open-screenshot-generator/src/hooks/use-collab.ts` (MIT) — React wiring of a session to the editor store.
  - `open-screenshot-generator/src/components/open-screenshot-generator/collab/CollabBoardOverlay.tsx`, `CollabBar.tsx`, `CollabFace.tsx`, `CollabDialog.tsx` (MIT) — remote cursor overlay on boards, avatar stack, join dialog; UI patterns to restyle with Chitrapx components.
  - `open-screenshot-generator/src/lib/collab/links.ts` (MIT) — invite link design: slug in the query, key in the URL fragment so the server never sees it. Not needed for Chitrapx (auth plus RLS replaces it) but explains why their design is peer-to-peer.
  - `open-screenshot-generator/infra/vps/mcp-relay/src/collab.js` (MIT) — the y-webrtc signalling server (subscribe/unsubscribe/publish/ping, ticket auth). Only relevant if a Yjs option is chosen.
  - `open-screenshot-generator/infra/vps/pb-hooks/070_collab.pb.js` (MIT) — single `whoami` route that gates the relay.
- **License note:** MIT: ideas and code reusable with attribution in `NOTICES.md`. The Yjs mapping code is tied to their `ArtboardState` shape and will not drop in. Do not use storeshots (AGPL-3.0) for this.
- **Size:** L

#### Sync approach options

| Option | How it works | Pros | Cons |
|---|---|---|---|
| A. Yjs (CRDT) over y-webrtc P2P, as the competitor | Doc mirrored into `Y.Doc`; peers sync directly; signalling relay | Proven in the reference; offline merge for free; no server ordering | No authoritative server state: Postgres `doc`/`revision`, RLS, role checks, version history and server-side rendering all need a second sync path from Y to JSON; P2P cannot enforce viewer vs editor; WebRTC fails behind some corporate NATs; a second doc model duplicates `Command` semantics |
| B. Yjs with a server provider (y-websocket or Hocuspocus) persisting to Postgres | Same Y.Doc, central server | Offline merge, awareness built in, authority at the server | Needs a long-lived websocket service (cannot run on Vercel serverless; a new deployment target next to `apps/worker`); every one of the 19 command types must be re-expressed as Y operations; render/export and AI jobs read JSON `doc`, so a Y-to-JSON projection is needed on each save; role enforcement requires custom provider code |
| C. Server-ordered command log over Supabase Realtime (recommended) | Client POSTs commands, server validates, assigns `seq` in a transaction, applies `applyCommand`, broadcasts; peers apply in `seq` order; clients rebase pending commands over remote ones | Reuses the existing pure `Command` model and `applyCommand`; Postgres stays the single source of truth so render, export, versions and RLS keep working; role checks happen in the API route; Supabase Realtime is already in the stack, no new service; revision/409 logic generalises into seq | Last-writer-wins per property (fine for a layout editor); needs a rebase step and inverse-command undo; text inside one element is whole-string last-write-wins (revisit with Yjs text only if users complain); Realtime message size and rate limits apply (drags sent as one command at drag end plus a throttled preview broadcast) |

**Recommendation: Option C.** The editor was built on pure commands precisely so changes can be replayed; the server already owns an authoritative, validated, versioned doc; and a layout editor with a handful of users per project rarely needs CRDT merge semantics. Option A is the cheapest to build but conflicts with roles, server rendering and billing enforcement. Revisit Yjs for in-element text only if needed. Spike first: measure Supabase Realtime latency and per-channel message limits with a drag at 60 Hz before committing.

### 15.4 Comments on boards

- **What it does:** Members pin comments to a board (or a specific element), reply in threads and resolve them; viewers can comment too.
- **Details:**
  - Anchor: `projectId` + `boardId` (+ optional `elementId` and a point in board coordinates, stored as percentages so size changes do not move it). If the board or element is deleted the thread stays and shows as "orphaned" on the project, not lost.
  - Fields: body (plain text, max 2000 chars), author, created/edited time, `resolved_at` and `resolved_by` on the thread root.
  - Realtime: new comments and resolutions appear live using the same Realtime channel as 15.3 (works without 15.3 by polling).
  - Mentions `@name` notify by email or in-app (decide, see open questions).
  - Permissions: viewer, editor, admin, owner can create; author can edit/delete own; admin/owner can delete any. Comments are not part of the project `doc`, so they never appear in exports, renders or share-link previews, and are not copied by "duplicate into my workspace".
  - Comments are not versioned in `project_versions`; restoring a version (SP9) keeps comments.
  - A "show comments" toggle in the editor to avoid clutter.
- **Acceptance criteria:**
  - Adding a comment on board 2 shows a pin on board 2 for another member within 2 s; reload keeps it.
  - Reply nests under the thread; resolve hides the pin (toggle to show resolved); reopen restores it.
  - A viewer can comment; a user outside the workspace cannot read comments (RLS test); a share-link visitor sees no comments.
  - Deleting the commented element keeps the thread, flagged orphaned; deleting the board does the same.
  - Author can edit and an "edited" mark shows; a non-author editor cannot edit another's comment (403).
  - Comments are absent from the exported PNG/ZIP and from the doc JSON.
- **Chitrapx today:** nothing. Elements have stable ids so anchoring is feasible; there is no comments table and no notification mechanism.
- **Chitrapx changes:**
  - DB: `project_comments (id, workspace_id, project_id, board_id, element_id null, parent_id null, x_pct, y_pct, body, author_id, created_at, edited_at, resolved_at, resolved_by)` with index `(project_id, board_id)`; migration `0011_*.sql`; RLS select for members, writes server-only (consistent with `0002_lock_down_writes.sql`).
  - API: `apps/web/src/app/api/projects/[projectId]/comments/route.ts` and `[commentId]/route.ts`; server module `apps/web/src/server/comments.ts`.
  - UI: comment layer and sidebar in `apps/web/src/editor/ui` (new `Comments*.tsx`), pin overlay in the canvas, count badge on project cards under `apps/web/src/app/dashboard/projects`.
  - Realtime: reuse the channel from 15.3, or postgres_changes on `project_comments` filtered by `project_id`.
- **Reference code:**
  - None in the six repos: a search for comment, annotation and thread code found no feature to study.
  - `open-screenshot-generator/src/components/open-screenshot-generator/collab/CollabBoardOverlay.tsx` (MIT) — only as a pattern for overlaying per-user markers on a board in board coordinates; pins can reuse the same positioning approach.
- **License note:** Chitrapx-original. Overlay positioning idea only, from MIT code.
- **Size:** M

## Data model and API changes

Migrations (numbering continues after `0008_billing.sql`; adjust to whatever SP9 to SP12 have taken):

| Table / change | Purpose |
|---|---|
| `member_role` enum: `owner, admin, editor, viewer` (replaces `member`) | 15.2 |
| `workspace_invites (id, workspace_id, email, role, token_hash, invited_by, expires_at, accepted_at, revoked_at)` | 15.2 |
| `project_shares (id, workspace_id, project_id, slug unique, allow_duplicate, expires_at, created_by, revoked_at)` | 15.1 |
| `project_commands (project_id, seq, command jsonb, client_id, client_seq, user_id, created_at)` | 15.3 |
| `project_comments (...)` | 15.4 |
| `PlanLimits.maxSeats` in `packages/db/src/plans.ts` | 15.2 |

RLS changes:
- Keep `is_member(ws)` for read policies. Add `member_role_in(ws)` (security definer, `set search_path = public`, execute revoked from public/anon like `0001_rls.sql:7`) for role-aware policies.
- All new tables: RLS enabled, members select via `is_member`; no write policies for `authenticated`, writes through the privileged server (same stance as `0002_lock_down_writes.sql`, which exists because users hold a JWT and can reach PostgREST directly). Server routes enforce role with `requireRole`.
- `project_shares`: members read; the public preview reads through a server route using the privileged connection and the slug, never through anon RLS.
- `realtime.messages` authorization policy for private channels `project:<uuid>`: select/insert allowed only if the user is a member of the project's workspace; client broadcast of presence for all roles, but command publishing only by the server (service role) after the API route checked role editor or above. Viewers get presence only.
- `memberships`: `memberships_read` stays; role changes and deletes are server-only.
- Tests: extend `packages/db/test/rls.test.ts` with a viewer, an editor, an outsider and a share-link visitor for every new table.

APIs:
- `GET/PUT/DELETE /api/projects/:id/share`, `GET /api/shared/:slug[/doc]`, `POST /api/shared/:slug/duplicate`
- `GET/PATCH/DELETE /api/members`, `POST /api/invites`, `POST /api/invites/:token/accept`
- `POST /api/projects/:id/commands`, `GET /api/projects/:id/commands?after=`
- `GET/POST/PATCH/DELETE /api/projects/:id/comments`
- Existing `PUT /api/projects/:id/doc` stays for single-user mode and compaction; in a collaborative session it must be refused unless it comes from the compactor, with the 409 path kept as the safety net.

## Open questions

1. Seat numbers and pricing: free 1 / pro 3 / studio 10 are placeholders. Are extra seats a Razorpay add-on or a per-seat subscription quantity? Are viewers free (not counted as seats)? Razorpay add-on support must be confirmed against the subscription model in `server/billing.ts`.
2. Is the invite bound to an email, or can any signed-in user with the link join? Bound is safer; a link is easier.
3. One user in multiple workspaces: requires workspace switching and changes `requireContext`. Ship that in this sub-project, or restrict to one workspace per user plus invites that move a user (simpler, but loses the personal workspace)?
4. Email provider for invites and mentions: none found in the repo; need Resend/SES/Supabase Auth invite, or in-app only.
5. Does SP9 expose `applyCommand` and the doc schema in a shared package usable server side? If the command set changes in SP9 the log format needs a `command_schema_version`.
6. Credit spending by editors: does the workspace pool pay for everyone's jobs, and do we need per-member attribution or caps?
7. Do shared-link previews allow viewing all locales and groups, or only the primary one?
8. Comment writes: through the server API (consistent with the lock-down) or direct via PostgREST for lower latency? Recommended: server API.
9. Realtime limits on the chosen Supabase plan (message rate, concurrent connections, payload size); confirm in the spike before committing to Option C.
10. Compaction cadence for `project_commands` vs the existing `AUTO_SNAPSHOT_EVERY = 20` versions, so SP9 restore points stay meaningful.

## Suggested build order

1. Roles and `Ctx.role` plus `requireRole` on every mutating route (15.2 foundation, no UI yet); enum migration; RLS tests. Everything else depends on knowing who may do what.
2. Seat limits and invites (15.2): `maxSeats` in `PLANS`, invites table, accept page, team dashboard, over-limit and downgrade behaviour, Razorpay seat add-on if chosen.
3. Share by link (15.1): independent of sync and low risk; duplicate reuses project and asset copy code.
4. Comments (15.4): independent of sync; polling first, upgrade to Realtime in step 6.
5. Sync spike: Supabase Realtime latency and limits, server-side `applyCommand`, command log table and idempotent submit endpoint behind a feature flag, no UI.
6. Live co-editing (15.3): client outbox and rebase, inverse-command undo, presence and cursors, conflict rules, compaction to `projects.doc`, SP9 restore integration; then move comments to the same channel.
7. Hardening: property tests for convergence, load test with 10 editors, permission revocation while connected, abuse limits on public endpoints.
