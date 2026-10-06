# Sub-project 15.3: Live co-editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Presence, cursors and real-time command sync with per-user undo, over a server-ordered command log. Solo editing stays exactly as today.

**Spec:** `docs/superpowers/specs/2026-10-06-sp15-live-coediting-design.md` (acceptance criteria: `docs/roadmap/sp15-collaboration.md`, 15.3).

**Tech stack:** Next.js 16 (read `apps/web/node_modules/next/dist/docs/` before touching Next APIs), React 19, Zustand + Immer, Drizzle + Postgres, Supabase Realtime (`@supabase/supabase-js` 2.117), Vitest.

## Global constraints

- Billing is Razorpay only; nothing here charges or prices.
- SP13 and SP14 are dropped.
- No document `schemaVersion` bump. Every editor change is one `apply(command)`.
- **One migration, `0015_*`**, chained after 0013, because 0014 belongs to the roles branch. It is not run against the shared database. DB tests that need `project_commands` run against a throwaway container:

  ```bash
  docker run -d --name sp15-pg -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55415:5432 public.ecr.aws/supabase/postgres:17.11.0.002
  (cd packages/db && DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55415/postgres npx drizzle-kit migrate)
  DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55415/postgres pnpm --filter @chitrapx/web exec vitest run test/commands.server.test.ts
  docker rm -f sp15-pg
  ```

- DB tests run with `--testTimeout=90000 --hookTimeout=90000`.
- Do not run the dev server, MinIO or e2e.
- Do not touch the roles branch's files: `server/context.ts`, permissions, invites, shares, comments, `plans.ts`.

## Tasks

Each task goes failing test → watch it fail → implement → pass → commit.

### Task 1: Structural diff and conditional patch (`editor/sync/patch.ts`)
- [ ] Write `diffDocs(a, b): PatchOp[]`, `applyPatch(doc, ops, { force })`, `invertOps(ops)` and `squashOps(ops)`.
- [ ] Add the `patch` command to `commands.ts`. `applyCommand` delegates to `applyPatch`.
- [ ] Tests in `test/syncPatch.test.ts`:
  - [ ] round trip: `applyPatch(a, diff(a, b))` equals `b` for property edits, inserts, removals and reorders of elements and boards, and locale changes;
  - [ ] invert: `applyPatch(b, invert(diff(a, b)))` equals `a`;
  - [ ] a conditional op is skipped once someone else changed that property;
  - [ ] a set on a deleted element does nothing, so nothing is resurrected;
  - [ ] `__proto__` paths throw;
  - [ ] unchanged subtrees keep their identity.

### Task 2: Server batch step (`editor/sync/log.ts`)
- [ ] Write `applyBatch({ doc, head, lastClientSeq, clientId, userId, items, validate })`, which returns `{ doc, head, entries, results }`.
- [ ] Write `isSafeCommandJson`, `COMMAND_SNAPSHOT_EVERY` and `crossedSnapshot`.
- [ ] Tests in `test/syncLog.test.ts`:
  - [ ] consecutive seqs;
  - [ ] duplicates are acknowledged and not applied twice;
  - [ ] a command whose result fails validation is rejected while the others apply;
  - [ ] the fast path validates once;
  - [ ] a missing-target command is logged as a no-op.

### Task 3: Client sync core (`editor/sync/core.ts`)
- [ ] Write `initSync`, `addLocal`, `hold`, `releaseHeld`, `integrate` (which returns a gap flag), `applySnapshot`, `dropRejected`, `view`, `coalesce` and `outgoing`.
- [ ] Tests in `test/syncCore.test.ts`:
  - [ ] the rebase keeps pending commands on top of remote entries;
  - [ ] own entries pop pending;
  - [ ] a gap is reported;
  - [ ] a snapshot drops pending commands up to `lastClientSeq`;
  - [ ] coalescing merges a typing burst and sums moves, but never merges across in-flight commands or when the merge would change the result.

### Task 4: `LiveSync` engine with fake transport (`editor/sync/engine.ts`)
- [ ] Write the engine with an injected transport and timers, a status callback, `flush`, `catchUp`, `reset`, `receive`, `local` and `gestureEnd`.
- [ ] Write `test/support/fakeLive.ts`: an in-memory server that uses `applyBatch`, plus a broadcast hub that can delay, drop and reorder.
- [ ] Tests in `test/syncEngine.test.ts`:
  - [ ] two clients editing different elements both survive;
  - [ ] the same property converges in server order;
  - [ ] a delete during the other client's drag does not resurrect the element;
  - [ ] 100 offline commands are sent once on reconnect, with no duplicates after a lost response;
  - [ ] a dropped broadcast is recovered by catch-up;
  - [ ] a whole-document write (a hole) leads to a snapshot plus rebase;
  - [ ] a property test: random interleavings of three clients converge, and the server document equals the fold of the log.

### Task 5: Store: undo steps, sink and remote documents (`editor/store.ts`)
- [ ] `past` and `future` hold `UndoStep { before, after, ops? }`.
- [ ] Add `savedDoc`.
- [ ] Add `setSink(sink | null)`; the sink receives `apply`, `endGesture` and the undo/redo patches.
- [ ] Add `remoteDoc(doc, { revision, dirty })`. It keeps history and rebases an open gesture.
- [ ] Live undo applies inverted ops as a `patch` command.
- [ ] Tests:
  - [ ] the existing `store.test.ts` and `commands.test.ts` still pass;
  - [ ] new: A's undo keeps B's later edit;
  - [ ] new: undo after a remote change to another property;
  - [ ] new: redo;
  - [ ] new: a gesture interrupted by a remote edit undoes only the gesture;
  - [ ] new: `savedDoc` is kept by `markSaved` and `replaceDoc`.

### Task 6: Migration 0015 and RLS
- [ ] Add `projectCommands` to `packages/db/src/schema.ts`.
- [ ] Generate, rename to `0015_sp15_live_coediting.sql` (journal `idx` 15), then append the RLS statements, `can_use_project_topic` and the guarded `realtime.messages` policies.
- [ ] Extend `packages/db/test/rls.test.ts`:
  - [ ] an outsider cannot read, insert, update or delete `project_commands`;
  - [ ] a member reads their own and cannot insert;
  - [ ] `can_use_project_topic` is true for members on both topics and false for outsiders and malformed topics.
- [ ] Run against the local container.

### Task 7: Server commands API and Realtime broadcast
- [ ] `server/realtime.ts`: `broadcast(topic, event, payload)` via `POST {SUPABASE_URL}/realtime/v1/api/broadcast` with the service-role key (`private: true`). It is injectable and never throws; a failure is logged.
- [ ] `server/commands.ts`: `canSendCommands`, `submitCommands(ctx, projectId, raw, deps)` and `commandsSince(ctx, projectId, after, clientId)`.
- [ ] Route `app/api/projects/[projectId]/commands/route.ts` (GET, POST).
- [ ] The doc `PUT` and restore routes broadcast `head` after commit.
- [ ] Tests:
  - [ ] `test/realtime.test.ts`: fake fetch;
  - [ ] `test/commands.server.test.ts` (local container):
    - [ ] submit applies, logs and broadcasts after commit;
    - [ ] resubmission is idempotent;
    - [ ] catch-up returns entries, or a snapshot after a `saveDoc`;
    - [ ] a version every 100;
    - [ ] an invalid command is rejected and not logged;
    - [ ] another workspace gets 404;
    - [ ] a `saveDoc` then a submit on the new head;
    - [ ] the stored document equals the fold of the log.

### Task 8: Client live wiring
- [ ] `editor/live/presence.ts` (pure): `colorFor`, `peersFrom(presenceState, me)`, `throttle`, `unknownAssetIds(doc, urls)`. Tests in `test/livePresence.test.ts`.
- [ ] `editor/live/channel.ts`: the Supabase private channels, `setAuth`, presence `track`, and the broadcast helpers.
- [ ] `editor/live/useLiveSync.ts`:
  - [ ] mode switching (enter on a peer, leave after 10 s alone with nothing pending);
  - [ ] the handoff patch, and the 409 handoff;
  - [ ] the IndexedDB live draft and recovery on load;
  - [ ] status, flush and adopt;
  - [ ] cursor, preview and poke.
- [ ] `save.ts`: `pause()`, `resume()`, the `onConflict` hook, and export `tabId` and `isTabAlive`.
- [ ] UI:
  - [ ] `ui/PresenceBar.tsx` in the Toolbar;
  - [ ] `ui/RemoteOverlay.tsx` in the Canvas layer;
  - [ ] the `reconnecting` status label;
  - [ ] the Editor page passes `me` and `canEdit`.

### Task 9: Docs and the final gate
- [ ] Update the roadmap status and PENDING (15.3 built, migration 0015 not applied, rechain after 0014).
- [ ] `pnpm typecheck` and `pnpm lint` are clean; every touched test passes.

## Manual two-browser checks (not run here)

Use two browsers (or one normal and one private window) signed in as two members of one workspace, on one project. Migration 0015 must be applied, and Realtime private channels must be allowed.

1. Both avatars show in each toolbar. Each cursor shows on the other side, in that user's colour, with their name.
2. Drag an element in A. B sees a dashed preview while the drag lasts, and the element lands within 1 s of release. The database `revision` goes up by one.
3. A edits element 1's text while B moves element 2 at the same time. Both survive on both sides and after a reload.
4. Both set the same text colour within a second. Both end up with the same value, the later one by server order.
5. B deletes an element that A is dragging. A's drop changes nothing, and the element does not come back.
6. A undoes after B made a later edit to another element. Only A's change reverts.
7. Take A offline in devtools, make 20 edits, then reconnect. The status goes from Offline to saved, B gets all 20, and nothing is applied twice (`project_commands` has 20 rows for A's client id).
8. Block the websocket in A. The status shows "Reconnecting", edits still save over HTTP, and after unblocking the document equals the server's.
9. Run AI translate in A while B edits. B's edits survive, both see the translations, and B's editor never locks.
10. Restore a version in A. B jumps to the restored document and keeps any edit it had pending.
11. Close B. After 10 s, A is back in solo mode: a `PUT /doc` appears in the network tab on the next edit.
12. As an outsider, subscribing to `project:<id>` in the console is refused, and sending a broadcast on `project:<id>` as a member is refused.
