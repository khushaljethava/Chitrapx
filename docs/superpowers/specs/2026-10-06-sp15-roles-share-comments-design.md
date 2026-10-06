# Sub-project 15 (part 1): Roles, share by link, comments

Workspaces get teammates with roles and plan seat limits (15.2), a project can be shared as a read-only link that signed-in visitors may duplicate (15.1), and members leave threaded comments on boards (15.4). Live co-editing (15.3) is built on a separate branch and only consumes the permission helper defined here. Feature breakdown and acceptance criteria: `docs/roadmap/sp15-collaboration.md`.

## Decisions

### Roles and the one permission helper (15.2)

- **Roles**: `owner | admin | editor | viewer` (`member_role` enum). Ranked viewer < editor < admin < owner.
- **Actions** (`apps/web/src/server/authz.ts`), each with a minimum role:

  | Action | Minimum role | Used by |
  | --- | --- | --- |
  | `view` | viewer | every read |
  | `comment` | viewer | create, edit own, resolve comments |
  | `edit` | editor | apps, projects, doc saves, versions, uploads, fonts, community import, duplicate a share |
  | `spend` | editor | anything that starts a credit-spending job (AI, export, video, bundle, import, launch assets) |
  | `share` | editor | share links, community publish |
  | `members` | admin | invite, revoke invites, change roles, remove members |
  | `billing` | owner | orders, subscriptions, cancel |

- API: `can(ctx, action): boolean`, `authorize(ctx, action): void` (throws 403 `forbidden` with a sentence naming the role needed) and `requireContext(action = "view")`, which authorizes before returning. `Ctx` is now `{ userId, workspaceId, plan, role }`.
- **Where it is enforced**: in the route handlers, by passing the action to `requireContext`. A test walks every `app/api/**/route.ts` and fails if a POST, PUT, PATCH or DELETE handler does not ask for a non-`view` action (a short allow-list covers the Razorpay webhook, analytics events, leaving a workspace, invite acceptance, workspace switching and the per-action community route, which calls `authorize` itself). `saveDoc` and the editor stay untouched; `PUT /api/projects/:id/doc` asks for `edit`. 15.3's command route should call `requireContext("edit")`, and presence/read with `requireContext()`.
- **Exactly one owner**: a partial unique index `memberships_one_owner` on `(workspace_id) where role = 'owner'`. The owner cannot leave, be removed or be demoted; ownership moves only by the owner assigning `owner` to another member, which demotes the old owner to admin in the same transaction. Admins manage every member except the owner and cannot grant `owner`.
- **Removal is immediate**: the membership row is deleted, so the removed user's next request for that workspace gets 403 `access_removed`. An open editor polls `GET /api/me` every 30 s (and on focus) and shows a blocking "access removed" overlay. Realtime disconnects belong to 15.3.
- **Viewers in the editor** get a read-only page (the existing `ProjectBoards` viewer plus the comments panel) instead of the editor, so no editor state code changes and nothing can autosave.

### Several workspaces per user (15.2)

The acceptance criteria require it ("a user in two workspaces can switch between them"), so it ships:

- The current workspace is a cookie, `chitrapx_ws=<workspaceId>` (httpOnly, `sameSite=lax`, one year). `requireContext` lists the user's memberships, picks the one named by the cookie, or the oldest when there is no cookie. A cookie naming a workspace the user no longer belongs to is 403 `access_removed` (never a silent fall-back, so a removed member cannot keep writing into the wrong workspace by accident).
- `POST /api/workspaces/switch { workspaceId? }` sets the cookie after checking membership; without an id it clears it (back to the personal workspace). The dashboard header has a switcher when the user has more than one workspace; the "access removed" page offers the same reset.
- Every user keeps their personal workspace (created at first sign-in as today). Accepting an invite adds a membership and switches to it.
- Project and editor links are scoped to the current workspace, as today; opening another workspace's project while switched elsewhere is a 404.

### Seats (15.2)

- `PLANS[plan].maxSeats`: free 1, pro 3, studio 10 (the roadmap's placeholders, business-tunable). Every member counts, viewers included, plus pending invites (not accepted, not revoked, not expired).
- An invite past the cap is 403 `plan_limit` with `limit: "seats"`, the plan and the cap, `upgradeUrl: "/dashboard/billing"`, and the message "Your Free plan includes 1 seat. Upgrade to Pro or Studio in Billing to invite more people." Upgrading is the existing Razorpay plan subscription; there is no per-seat add-on and no new billing code.
- Downgrading never deletes members. While over the cap, new invites are refused and the team page shows an over-limit banner. Accepting an invite also re-checks that the members alone are still under the cap.

### Invites without email (15.2)

- There is no outbound email service in the repo and we are not adding one. An invite produces a **copyable link** `/invite/<token>` shown once to the admin, who sends it however they like.
- The token is 32 random bytes (base64url). Only its SHA-256 is stored (`workspace_invites.token_hash`, unique). Expiry 7 days. Inviting the same email again revokes the earlier pending invite.
- The invite is **bound to the invited email**: it can be accepted only by a signed-in user whose email matches (case-insensitive). Opening the link signed out goes to login and back. Errors: used (410 `invite_used`), expired (410 `invite_expired`, with the date), revoked (410 `invite_revoked`), unknown (404), other email (403 `invite_wrong_email`, naming the invited address), already a member (409 `already_member`).
- Acceptance is single-use: one `update … where accepted_at is null and revoked_at is null and expires_at > now() returning` under the workspace lock, then the membership insert, in one transaction.
- Invitable roles: admin, editor, viewer. Owner is reached only by transfer.

### Share a copy by link (15.1)

- `project_shares`: one active link per project (partial unique index on `project_id where revoked_at is null`). The slug is 18 random bytes, base64url (24 characters, 144 bits). "Regenerate" revokes the active row and inserts a new one; "disable" sets `revoked_at`. Options: `allow_duplicate` (default on) and an optional `expires_at`.
- Public `GET /api/shared/<slug>` and page `/s/<slug>` resolve the slug through the server's privileged connection only (no anon RLS). Unknown, revoked or expired slugs are 404 on the very next request (no caching: `Cache-Control: no-store`).
- The preview is the community snapshot approach, but read-only: the current server doc, migrated, with `brand` (the app id) removed; plus signed URLs for the assets that doc references in its own workspace (the existing `assetUrlMap`, which rebuilds paths from workspace and hash and skips competitor references); plus render extras limited to the doc's font families and the app palette. Signed URLs are the storage default of one hour. The response is an explicit allow-list: `{ name, kind, doc, assetUrls, extras, allowDuplicate }`, so it never carries `workspace_id`, `updated_by`, ids of other projects or any email. Comments are never included.
- The page renders with the existing read-only `ProjectBoards` (language switcher included), sets `robots: noindex, nofollow`, and the API sends `X-Robots-Tag: noindex`. Both are rate-limited per client IP (in-memory fixed window, 60 per minute per process; enough to stop scraping a slug, not a DDoS defence).
- **Duplicate into my workspace** (`POST /api/shared/<slug>/duplicate { appId? }`): requires sign-in and `edit` in the visitor's current workspace, `allow_duplicate`, and room under `maxProjects` (403 `plan_limit` otherwise). It reuses the community import path: each referenced screenshot, image or recording (with its converted WebM and poster) is copied to `<myWorkspace>/<sha256>` if absent, gets an asset row on the target app and `asset:<id>` sources are re-pointed. Uploaded fonts are not copied (licences are per workspace; text falls back as in community imports). The copy is named "<name> (copy)", has `revision = 0`, `brand.appId` = the target app, no share link and no comments. Without `appId` the oldest app is used; with no app at all it is 400 "Create an app first".
- The share popover lives on the project page in the dashboard (next to "Share to community"), not in the editor toolbar.

### Comments (15.4)

- `project_comments`: `id, workspace_id, project_id, board_id, element_id?, parent_id?, x_pct?, y_pct?, body, author_id, created_at, edited_at, resolved_at, resolved_by`, index `(project_id, board_id)`. A reply has `parent_id` set to the thread root (replying to a reply attaches to its root; threads are one level deep) and inherits the root's board.
- Body: plain text, 1–2000 characters after trimming. A new thread must name a board that exists in the current doc; the element, if given, must exist on that board.
- **Orphans** are computed when listing: a thread whose board or element no longer exists comes back with `orphaned: true` and stays listed under "Orphaned".
- Permissions: any role may create, reply and resolve or reopen (`comment`). Only the author edits (403 otherwise, `edited_at` set, "edited" shown). The author or an admin/owner deletes; deleting a root deletes its replies.
- Comments are separate from the doc: never in exports, renders, share previews, versions or duplicates. Restoring a version keeps them.
- **Live updates by polling**: the editor panel polls every 1.5 s while the tab is visible. 15.3's Realtime channel can replace the poll later.
- **Notifications are in-app only** (`notifications` table, no email): a reply notifies the thread's author and earlier repliers; `@handle` notifies the mentioned member, where a handle is a member's profile name without spaces or their email's local part (case-insensitive). Never the actor. A bell in the dashboard header shows the unread count and the latest 20, each linking to the editor with the thread open; opening the list marks them read.
- UI: a "Comments" toggle in the editor opens a side panel inside the editor context (one `children` slot added to `Editor.tsx`, the only editor-shell edit). New threads anchor to the selected element, else the active board; clicking a thread selects its board and element through existing store actions. There are no pins drawn on the canvas in this part (the canvas overlay is shared with 15.3's cursors; see Deferred).

### Data model: one migration, `0014_*`

- `member_role`: rename the old type, create `owner, admin, editor, viewer`, convert the column with `case role::text when 'member' then 'editor' else role::text end`, drop the old type. Existing owners stay owners; any `member` becomes `editor` (same powers they had). The column default becomes `viewer` (least privilege; every insert in the code names its role).
- New tables: `workspace_invites`, `project_shares`, `project_comments`, `notifications`.
- RLS, matching `0001_rls.sql`/`0002_lock_down_writes.sql` (read policies only; every write goes through the server role):
  - `member_role_in(ws)`: security definer, `search_path = public`, execute revoked from public and anon.
  - `workspace_invites`: readable by the workspace's owner and admins only.
  - `project_shares`, `project_comments`: readable by members (`is_member`).
  - `notifications`: readable by their recipient only.
- **Not applied to the shared database.** Tests that need it run against a throwaway local Supabase Postgres with migrations 0000–0014.

### Not changed

- No document `schemaVersion` bump; no editor command added or changed.
- Billing stays Razorpay; nothing new is sold. SP13 and SP14 stay dropped.
- `editor/store.ts`, `editor/save.ts` and `saveDoc` are not edited.

### Deferred

- Pins drawn on the canvas at `x_pct/y_pct` (needs `Canvas.tsx`, where 15.3 draws cursors); the panel already stores the anchor.
- Realtime delivery of comments and dropping a removed member's Realtime channel (15.3).
- Seat add-ons, email delivery of invites and mentions.
