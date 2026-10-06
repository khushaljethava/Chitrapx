# Sub-project 15.3: Live co-editing

Two or more members open the same project and see each other's avatars, cursors and selections. Edits appear for everyone within about a second, without save conflicts. Feature breakdown and acceptance criteria: `docs/roadmap/sp15-collaboration.md` (15.3). This builds option C from that file: a server-ordered command log over Supabase Realtime. 15.1, 15.2 and 15.4 (share links, roles, comments) are built on another branch.

## Decisions

### Two modes: solo and live

- **Solo** is today's editor, unchanged: whole-document autosave (`PUT /doc`) 1.5 s after the last change, the IndexedDB draft, and the 409 conflict dialog.
- **Live** starts when presence shows another editor session (another tab or member) on the project. Edits then go to the server as commands; nobody saves whole documents.
- Live ends when the session has been alone for 10 s with nothing left to send. The editor falls back to solo, with its revision equal to the server's head.
- If Realtime never connects (no private channel access, blocked websocket), the editor stays solo. A broken Realtime setup therefore never changes single-user behaviour.
- **Entering live with unsaved solo edits** never saves the whole document. The store keeps `savedDoc`, the last document the server confirmed. The unsaved difference `diff(savedDoc, doc)` becomes one forced `patch` command, and the editor joins at the saved revision. A save that is already in flight is awaited first. If that save hits a 409 while Realtime is connected, the same handoff runs, so a peer who joined a moment earlier never causes the conflict dialog. The dialog remains for when Realtime is down, and for drafts whose base is unknown.

### Server-ordered command log

- New table `project_commands (project_id, seq, workspace_id, client_id, client_seq, user_id, command jsonb, created_at)`.
  - Primary key `(project_id, seq)`.
  - Unique `(project_id, client_id, client_seq)`, which makes resubmission idempotent.
- `projects.revision` is the head: every accepted command takes the next revision as its `seq`. Whole-document writers keep bumping the revision without a log row. These are the solo `PUT`, version restore and the worker's AI jobs. A reader that finds a hole in the log takes a snapshot instead.
- `POST /api/projects/:id/commands` takes `{ clientId, after, commands: [{ clientSeq, command }] }`, with at most 100 commands per request. Inside one transaction it:
  1. locks the project row (`for update`), which serialises with the worker's `updateProjectDoc`, restore and named versions;
  2. reads this client's highest logged `client_seq`. A command at or below it is a duplicate: it is acknowledged and not applied again;
  3. applies each command with the editor's own pure `applyCommand`, then validates with `migrate` and `MAX_DOC_BYTES`. It tries one validation for the whole batch first and falls back to one per command. A command that throws or yields an invalid document is rejected with a reason and not logged; the rest still apply;
  4. stores the document and head, and appends the log rows;
  5. writes a `project_versions` row when the head crosses a multiple of 100 (`COMMAND_SNAPSHOT_EVERY`). Per-command revisions would otherwise flood the 50 kept automatic versions; solo `PUT` keeps its "every 20th revision".

  After commit it broadcasts the new entries. The response holds a per-command result plus a catch-up from `after`, so the client never depends on Realtime to learn what it wrote.
- `GET /api/projects/:id/commands?after=N&clientId=…` is the catch-up:
  - the entries after `N`, when the log is contiguous up to the head and at most 200 entries;
  - otherwise a snapshot `{ doc, lastClientSeq }`.

  `lastClientSeq` is this client's highest logged sequence number. It lets the client drop pending commands the snapshot already contains, even when a response was lost.
- A command that targets something missing is a no-op in `applyCommand`, so every client drops it the same way. It is still logged, so acknowledgement stays simple and the log is the exact history.
- `canSendCommands(ctx)` in `server/commands.ts` is the single gate on who may submit. For now it returns `true`, after the workspace membership check that `getProject`-style ownership already does (`404` for other workspaces). The roles branch wires it to "editor or above".
- The `commands` route body limit is `MAX_DOC_BYTES + 64 KB`. The command envelope is checked with zod; the command itself is checked by applying it and validating the result. Any `__proto__`, `constructor` or `prototype` key anywhere in a command is refused.

### Client sync core (pure, unit-tested)

- `editor/sync/patch.ts` holds id-aware structural diff and patch over document JSON:
  - Paths use object keys and `{ id }` segments for arrays whose items all carry a string `id` (groups, boards, elements, span elements). Any other array is an atomic value.
  - Ops are `set` (with the old and new value, either possibly absent, plus the previous sibling's id for array items) and `order`.
  - Applying is conditional by default: an op applies only while the current value still equals its `old`. A missing parent or item skips the op, so nothing is ever resurrected.
- `editor/sync/log.ts` holds `applyBatch`, the pure server step: idempotency, apply, validate, results. The API and the in-memory fake server in tests both use it.
- `editor/sync/core.ts` holds the client state:
  - `confirmed` (the server document at `seq`);
  - `pending` (local commands with `clientSeq`, not yet in the log);
  - `held` (transient drag commands);
  - the view, which is `fold(confirmed, pending + held)`.
  - Remote entries are integrated in `seq` order. A gap triggers a catch-up. The client's own entries pop its pending commands. Everything still pending is re-applied over the new base: that is the rebase.
  - The unsent tail is coalesced. Consecutive `updateElement`, `setOverride` and `updateBoard` calls on the same target are merged, and `moveElements` calls on the same refs are summed. A merge is only kept if applying the merged command gives the same document as applying both, which is checked with the diff. Typing therefore never multiplies log rows.
- `editor/sync/engine.ts` is `LiveSync`: one request in flight, a 120 ms send delay, catch-up on gaps, head hints, reconnects and every 20 s. Network errors back off from 1 s to 10 s. A 403 or 404 stops the engine with "access removed". The transport (`submit`, `fetchSince`) is injected; tests use an in-memory server that interleaves two or three clients.
- Last writer wins per property, by server order. Concurrent `moveBoard` and reorders resolve in server order. Delete beats a later update (the update becomes a no-op). A drag of an element someone deleted ends as a no-op.

### Undo

- Undo stays per user. A step is `{ before, after, ops? }`. Its ops are `diff(before, after)`, or, for a gesture that remote edits interrupted, the gesture's own ops collected around them.
- **Solo:** while the document is still that step's `after`, undo restores `before` exactly, as today.
- **Live:** undo applies the inverted ops as a `patch` command, sent like any other command. Each op only reverts a property that still holds the value this user gave it. A later edit by someone else survives, and only this user's last change is reverted. Redo re-applies the forward ops under the same rule.
- This is the "re-diffing" option. No per-command inverse is written by hand, and it covers every command type, including AI rewrites and translations.

### Presence, cursors and drag previews

There are two private channels per project:

- **`project:<id>`, document events.** Only the server sends here, with the service-role key through the Realtime REST broadcast endpoint, after commit. Events:
  - `commands { entries }`;
  - `head { head }`, used when the payload would exceed 100 KB, and after a solo `PUT` or a restore.

  Clients only listen. Nothing a client broadcasts can change a document.
- **`project-live:<id>`, client to client.**
  - Presence carries `{ clientId, userId, name, avatarUrl, color, groupId, boardId, selection, canEdit }`.
  - A `cursor` broadcast carries `{ groupId, boardId, x, y }` in board coordinates, throttled to 60 ms.
  - A `preview` broadcast carries the dragged elements' boxes during a gesture, throttled to 80 ms and cleared at the end.
  - A `poke` hint after a doc job tells peers to catch up. The hint carries no data; peers fetch from the API.
  - Presence leaves when the socket drops (Supabase's heartbeat, about 30 s). A cursor fades after 10 s without movement.
- A drag sends one command at the end: the held transient commands, coalesced, usually into a single `moveElements` or `updateElement`. During the drag, peers see the throttled preview outline in the dragger's colour.
- Colours come from a fixed palette indexed by a hash of the user id. The avatar stack sits in the toolbar. Remote cursors, selections and previews draw in the canvas interaction layer, in the peer's colour, with their name.
- Assets a peer adds that this editor has no URL for trigger one `refresh()` of the app's assets, at most every 3 s.

### Channel security

- Realtime Authorization on `realtime.messages`, in migration 0015. It is guarded so the migration also runs on a plain Postgres without the Realtime schema.
  - A `select` policy lets an authenticated user receive on `project:<uuid>` and `project-live:<uuid>` only if they are a member of that project's workspace. The check is `public.can_use_project_topic(topic)`, a security-definer function using `is_member`.
  - An `insert` policy lets members send broadcast and presence only on `project-live:<uuid>`.
  - There is no insert policy for `project:<uuid>`, so only the service role (which bypasses RLS) can publish document events.
- Clients join with `config.private = true` after `supabase.realtime.setAuth()`.
- Removal from a workspace: the next API call returns 404, the engine stops, and the editor shows "access removed". Realtime checks policies on join and on token refresh, so a removed member's socket lasts until the next refresh at worst. It can never write.
- Viewers (once roles land) get presence; `canSendCommands` refuses their commands.

### Offline, drafts and AI jobs

- **Live offline:** pending commands stay in memory and in IndexedDB (`live:<projectId>:<tab>`, holding the client id, its pending commands and its base). Status reads "Offline, kept on this device". On reconnect they are sent with their original `clientId` and `clientSeq`, so a retry is never applied twice. The server rebases them by applying them to the current head. Rejected ones are reported ("N edits could not be applied").
- **On load,** a live draft from this tab or a closed tab is submitted the same way, then the server document is adopted.
- **Doc jobs** (translate, chips): `flush` drains the outbox, the editor locks, the worker rewrites the document under the row lock, and the client adopts the server document. That resets the engine to the new head, and the client pokes peers. A peer whose catch-up hits the hole takes a snapshot and re-applies its pending commands. A peer's edits made during the job are never lost: the worker read-modify-writes under the same lock.
- **Restore** stays a whole-document server write. Peers see a hole and take a snapshot. A stale `revision` is still a 409, now rare.
- Render, export, versions and the worker keep reading `projects.doc`, which stays the single source of truth.

### Not changed

- The document schema has no `schemaVersion` bump. One command is added, `patch`, which is used by undo, redo and the live handoff. Existing documents pass `migrate` unchanged.
- Every editor change is still one `apply(command)`.
- `server/context.ts`, `Ctx`, permissions, invites, shares, comments and `plans.ts` are untouched.

### Migration

Migration `0015_sp15_live_coediting.sql` is chained after 0013, because 0014 belongs to the roles branch. The coordinator regenerates the snapshot and journal after merging 0014. The migration:

- creates `project_commands`;
- enables RLS on it, with `project_commands_read` (members select via `is_member`) and no write policy;
- adds `can_use_project_topic` and the guarded `realtime.messages` policies.

It is not applied to the shared database. Its tests run on a throwaway local Postgres.

## Out of scope

- Per-character text merging: text is whole-string last-writer-wins.
- Compaction of `project_commands` beyond the versions written every 100 commands. The log is small: one row per coalesced command.
- A cap of 10 editors. Presence shows everyone; the cap is a follow-up.
- Comments on the same channel (15.4).
- An enforced "access removed" banner beyond the status text.
- Two-browser automated tests, which cannot run here. A manual checklist is in the plan.
